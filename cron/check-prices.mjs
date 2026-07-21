// GitHub Actionsが定期実行するスクリプト。
// 1. Supabaseから監視中のETF一覧を取得
// 2. stooqから価格を取得
// 3. 下落レベル判定(AlertEngineロジック相当)
// 4. 該当すればプッシュ通知を送信し、Supabaseに記録

import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) {
  console.error("環境変数(SUPABASE_URL / SUPABASE_SERVICE_KEY / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)が不足しています");
  process.exit(1);
}

webpush.setVapidDetails("mailto:example@example.com", VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// 東証営業日判定(簡易版: 土日+年末年始のみ。詳細な祝日はholidays.jsonで拡張可能)
function isBusinessDayJST(date) {
  const jst = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const day = jst.getDay();
  if (day === 0 || day === 6) return false;
  const month = jst.getMonth() + 1;
  const d = jst.getDate();
  if ((month === 12 && d === 31) || (month === 1 && d <= 3)) return false;
  return true;
}

function todayJSTString(date) {
  return new Date(date.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }))
    .toISOString()
    .slice(0, 10);
}

// AlertEngine相当の純粋関数。05_ClaudeCodeRules.md/Blueprint §5.1のロジックを踏襲。
function decideLevel(changePct, levels, alreadyNotified) {
  const candidates = levels.filter((l) => changePct <= l);
  if (candidates.length === 0) return null;
  const reached = Math.min(...candidates);
  if (alreadyNotified == null) return reached;
  return reached < alreadyNotified ? reached : null;
}

async function fetchYahooQuote(code) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.T`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      console.warn(`${code}: Yahoo Finance HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    const price = result?.meta?.regularMarketPrice;
    const prevClose = result?.meta?.previousClose ?? result?.meta?.chartPreviousClose;
    if (typeof price !== "number" || Number.isNaN(price)) return null;
    return {
      price,
      previousClose: typeof prevClose === "number" && !Number.isNaN(prevClose) ? prevClose : null,
    };
  } catch (e) {
    console.warn(`${code}: Yahoo Finance取得エラー:`, e.message);
    return null;
  }
}

async function main() {
  const now = new Date();
  if (!isBusinessDayJST(now)) {
    console.log("非営業日のためスキップします");
    return;
  }

  const today = todayJSTString(now);

  const { data: settings } = await supabase.from("app_settings").select("*").eq("id", 1).single();
  const defaultLevels = settings?.default_alert_levels ?? [-3, -5, -7, -10];

  const { data: watched, error } = await supabase
    .from("etf_user_state")
    .select("*, purchase_plan_item(*)")
    .eq("is_watched", true);

  if (error) {
    console.error("Supabase取得エラー:", error);
    process.exit(1);
  }
  if (!watched || watched.length === 0) {
    console.log("監視中のETFがありません");
    return;
  }

  const { data: subscriptions } = await supabase.from("push_subscription").select("*");

  for (const state of watched) {
    // 当営業日が変わっていたらリセット
    let notifiedLevelToday = state.notified_level_today;
    if (state.last_updated_at) {
      const lastDay = todayJSTString(new Date(state.last_updated_at));
      if (lastDay !== today) notifiedLevelToday = null;
    }

    const quote = await fetchYahooQuote(state.code);
    if (quote == null) {
      console.warn(`${state.code}: 価格取得失敗、スキップ`);
      continue;
    }
    const { price: close, previousClose: yahooPrevClose } = quote;

    // 前営業日終値: 自前のdaily_price履歴を優先。無ければYahoo Financeが返すprevious closeで代用。
    const { data: prevRows } = await supabase
      .from("daily_price")
      .select("*")
      .eq("code", state.code)
      .lt("date", today)
      .order("date", { ascending: false })
      .limit(1);
    const previousClose = prevRows && prevRows[0] ? prevRows[0].close : yahooPrevClose;

    if (previousClose == null) {
      // 前日終値が取得できない場合のみ判定せず記録のみ
      await supabase.from("daily_price").upsert(
        { code: state.code, date: today, close, change_pct: 0, reached_level: null, notified: false },
        { onConflict: "code,date" }
      );
      continue;
    }

    const changePct = ((close - previousClose) / previousClose) * 100;
    if (Math.abs(changePct) > 30) {
      console.warn(`${state.code}: 異常値(${changePct.toFixed(1)}%)のためスキップ`);
      continue;
    }

    const levels = (state.custom_alert_levels ?? defaultLevels).slice().sort((a, b) => b - a);
    const reached = decideLevel(changePct, levels, notifiedLevelToday);

    await supabase
      .from("etf_user_state")
      .update({
        last_price: close,
        last_change_pct: changePct,
        last_updated_at: now.toISOString(),
        notified_level_today: reached != null ? reached : notifiedLevelToday,
      })
      .eq("code", state.code);

    await supabase.from("daily_price").upsert(
      { code: state.code, date: today, close, change_pct: changePct, reached_level: reached, notified: reached != null },
      { onConflict: "code,date" }
    );

    if (reached != null) {
      await supabase.from("notification_record").insert({
        code: state.code,
        date: today,
        fired_at: now.toISOString(),
        level: reached,
        price: close,
        change_pct: changePct,
      });

      const plan = (state.purchase_plan_item || []).find((p) => p.level === reached);
      const planText = plan ? `。計画: ${plan.amount.toLocaleString()}円` : "";

      // リバウンド統計(過去10年バックテスト: 1306/1321/2558/1475平均、レベル到達後10営業日)
      // 出典: 2026-07 実施のバックテスト(分割調整済み・分配金除く)
      const REBOUND_STATS = {
        "-2": { win: 73, avg: "+1.5" },
        "-3": { win: 61, avg: "+0.5" },
        "-5": { win: 59, avg: "+1.5" },
        "-7": { win: 100, avg: "+12", note: "※過去7回のみ" },
      };
      const st = REBOUND_STATS[String(reached)];
      const statText = st
        ? `\n参考: 過去10年、このレベル後10営業日の勝率${st.win}%・平均${st.avg}%${st.note || ""}`
        : "";

      const payload = JSON.stringify({
        title: state.code,
        body: `前日比 ${changePct.toFixed(1)}%（${reached}%到達）${planText}${statText}`,
        code: state.code,
      });

      for (const sub of subscriptions || []) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
        } catch (e) {
          console.warn(`通知送信失敗(${sub.endpoint.slice(0, 30)}...):`, e.statusCode || e.message);
          if (e.statusCode === 404 || e.statusCode === 410) {
            await supabase.from("push_subscription").delete().eq("id", sub.id);
          }
        }
      }
      console.log(`${state.code}: ${reached}%到達を通知しました`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
