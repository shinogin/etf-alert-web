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
    const volume = result?.meta?.regularMarketVolume;
    if (typeof price !== "number" || Number.isNaN(price)) return null;
    return {
      price,
      previousClose: typeof prevClose === "number" && !Number.isNaN(prevClose) ? prevClose : null,
      volume: typeof volume === "number" && !Number.isNaN(volume) ? volume : null,
    };
  } catch (e) {
    console.warn(`${code}: Yahoo Finance取得エラー:`, e.message);
    return null;
  }
}

// カテゴリ別デフォルト通知レベル。
// バックテスト(2026-07時点、過去10年・流動性フィルター後)で、指数連動型とテーマ/セクター型は
// 最良の閾値帯が異なることが分かったため、種別ごとに既定値を分ける。
// 指数系: 段階的に-3/-5/-8%で買い増し(勝率76.9%/86.5%/88.7%、3ヶ月後平均+8.5/+13.9/+18.2%)
// テーマ系: 段階的に-3/-7/-10%で買い増し(勝率65.0%/62.5%/65.5%、3ヶ月後平均+6.7/+7.3/+9.6%)
const INDEX_DEFAULT_LEVELS = [-3, -5, -8];
const THEME_DEFAULT_LEVELS = [-3, -7, -10];

const BROAD_INDEX_KEYWORDS = [
  "TOPIX", "日経225", "日経平均", "日経３００", "日経300",
  "JPX日経400", "JPX 日経 400", "JPXプライム150", "JPX日経インデックス400",
  "S&P500", "S&P 500", "NYダウ", "ダウ工業", "ナスダック100", "NASDAQ100", "NASDAQ-100",
  "MSCI ACWI", "MSCI-KOKUSAI", "MSCIコクサイ", "MSCI コクサイ",
  "FTSE 100", "DAX", "CSI300", "MSCIエマージング", "MSCI エマージング",
];

// レバレッジ/インバースはボラティリティ特性が別物なので、バックテスト対象外(=カテゴリ既定値なし)。
// この場合はグローバル既定値(app_settings.default_alert_levels)にフォールバックする。
function categoryDefaultLevels(catalogEntry) {
  if (!catalogEntry || catalogEntry.is_leveraged || catalogEntry.is_inverse) return null;
  const indexName = catalogEntry.index_name || "";
  const isBroadIndex = BROAD_INDEX_KEYWORDS.some((kw) => indexName.includes(kw));
  return isBroadIndex ? INDEX_DEFAULT_LEVELS : THEME_DEFAULT_LEVELS;
}

// リバウンド統計(過去10年バックテスト、流動性フィルター後、分割等の異常値除外)
// 出典: 2026-07 実施のバックテスト。カテゴリ(指数/テーマ)×通知レベル×経過営業日ごとの
// 勝率(win,%)・平均リターン(avg,%)・中央値リターン(med,%)・サンプル数(n)。
// 詳細(複数日数の一覧)はETF詳細画面で確認できるため、通知本文には代表的に10営業日のみ表示する。
const REBOUND_MATRIX = {"index":{"-3":{"10":{"n":1472,"win":65.5,"avg":1.5,"med":2.3},"15":{"n":1467,"win":65.6,"avg":2.1,"med":2.7},"20":{"n":1454,"win":70.1,"avg":3.7,"med":3.3},"30":{"n":1436,"win":74.0,"avg":4.9,"med":5.3},"63":{"n":1411,"win":79.9,"avg":9.5,"med":9.5}},"-5":{"10":{"n":326,"win":70.6,"avg":3.5,"med":4.8},"15":{"n":325,"win":69.8,"avg":5.0,"med":6.0},"20":{"n":324,"win":77.2,"avg":6.9,"med":7.9},"30":{"n":321,"win":76.3,"avg":7.4,"med":8.2},"63":{"n":319,"win":88.7,"avg":14.5,"med":16.1}},"-8":{"10":{"n":72,"win":81.9,"avg":7.3,"med":7.7},"15":{"n":72,"win":81.9,"avg":10.0,"med":11.9},"20":{"n":72,"win":84.7,"avg":12.0,"med":15.4},"30":{"n":72,"win":86.1,"avg":11.1,"med":14.3},"63":{"n":72,"win":87.5,"avg":18.5,"med":24.2}}},"theme":{"-3":{"10":{"n":4939,"win":59.9,"avg":1.1,"med":1.6},"15":{"n":4907,"win":59.7,"avg":1.5,"med":1.7},"20":{"n":4882,"win":60.6,"avg":2.3,"med":2.3},"30":{"n":4825,"win":61.1,"avg":2.6,"med":2.7},"63":{"n":4657,"win":66.3,"avg":6.8,"med":5.4}},"-7":{"10":{"n":600,"win":63.0,"avg":2.2,"med":3.8},"15":{"n":593,"win":65.4,"avg":3.6,"med":5.7},"20":{"n":590,"win":65.9,"avg":4.5,"med":5.9},"30":{"n":583,"win":64.8,"avg":3.5,"med":6.3},"63":{"n":575,"win":65.2,"avg":8.2,"med":8.3}},"-10":{"10":{"n":242,"win":69.0,"avg":4.3,"med":6.9},"15":{"n":241,"win":68.5,"avg":5.8,"med":11.4},"20":{"n":241,"win":68.9,"avg":6.9,"med":11.3},"30":{"n":240,"win":68.3,"avg":5.4,"med":10.4},"63":{"n":240,"win":68.3,"avg":10.9,"med":11.2}}}};

// ---- 複数日「じわじわ型」下落の判定 ----------------------------------------
// バックテストの知見: 同じ下落幅でも「単日急落型」のほうが短期リバウンドの質が高く、
// 数営業日かけてじわじわ下げた場合は同等のリバウンドを得るのにより深い累積下落が必要。
// 3営業日累積で 指数系 -14% / テーマ系 -16% を、単日レベルと同等の買い場と見なす。
const CUM_WINDOW_DAYS = 3;
const CUM_INDEX_LEVEL = -14;
const CUM_THEME_LEVEL = -16;

function cumulativeThreshold(catalogEntry) {
  const catLevels = categoryDefaultLevels(catalogEntry);
  if (catLevels == null) return null; // レバレッジ/インバースは対象外
  return catLevels === THEME_DEFAULT_LEVELS ? CUM_THEME_LEVEL : CUM_INDEX_LEVEL;
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
    .select("*, purchase_plan_item(*), etf_catalog(index_name,is_leveraged,is_inverse)")
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
    const { price: close, previousClose: yahooPrevClose, volume } = quote;
    const turnover = volume != null ? Math.round(volume * close) : null;

    // 前営業日終値: 自前のdaily_price履歴を優先。無ければYahoo Financeが返すprevious closeで代用。
    const { data: prevRows } = await supabase
      .from("daily_price")
      .select("*")
      .eq("code", state.code)
      .lt("date", today)
      .order("date", { ascending: false })
      .limit(CUM_WINDOW_DAYS);
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

    const levels = (
      state.custom_alert_levels ?? categoryDefaultLevels(state.etf_catalog) ?? defaultLevels
    ).slice().sort((a, b) => b - a);
    const reached = decideLevel(changePct, levels, notifiedLevelToday);

    await supabase
      .from("etf_user_state")
      .update({
        last_price: close,
        last_change_pct: changePct,
        last_volume: volume,
        last_turnover: turnover,
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


      const catLevels = categoryDefaultLevels(state.etf_catalog);
      const rebGroup = catLevels == null ? null : catLevels === THEME_DEFAULT_LEVELS ? "theme" : "index";
      const st = rebGroup ? REBOUND_MATRIX[rebGroup]?.[String(reached)]?.["10"] : null;
      const statText = st
        ? `\n参考: 過去10年、このレベル後10営業日の勝率${st.win}%・平均${st.avg}%・中央値${st.med}%(詳細はアプリで確認)`
        : "";

      const payload = JSON.stringify({
        title: state.code,
        body: `前日比 ${changePct.toFixed(1)}%（${reached}%到達）${planText}${statText}`,
        code: state.code,
      });

      await sendToAll(subscriptions, payload);
      console.log(`${state.code}: ${reached}%到達を通知しました`);
    } else {
      // 単日では閾値に届かなかった場合のみ、複数日「じわじわ型」の累積下落を判定する。
      // (最終日に大きく下げたケースは単日通知のほうが本質なので二重通知しない)
      const cumThreshold = cumulativeThreshold(state.etf_catalog);
      if (cumThreshold != null && prevRows && prevRows.length >= CUM_WINDOW_DAYS) {
        const baseClose = prevRows[CUM_WINDOW_DAYS - 1].close;
        if (baseClose > 0) {
          const cumPct = ((close - baseClose) / baseClose) * 100;
          if (cumPct <= cumThreshold && cumPct > -60) {
            // 当日すでに同じ累積レベルで通知済みなら送らない(スキーマ変更不要の重複防止)
            const { data: dup } = await supabase
              .from("notification_record")
              .select("id")
              .eq("code", state.code)
              .eq("date", today)
              .eq("level", cumThreshold)
              .limit(1);
            if (!dup || dup.length === 0) {
              await supabase.from("notification_record").insert({
                code: state.code,
                date: today,
                fired_at: now.toISOString(),
                level: cumThreshold,
                price: close,
                change_pct: cumPct,
              });

              const plan = (state.purchase_plan_item || []).find((p) => p.level === cumThreshold);
              const planText = plan ? `。計画: ${plan.amount.toLocaleString()}円` : "";

              const payload = JSON.stringify({
                title: state.code,
                body:
                  `${CUM_WINDOW_DAYS}営業日で累計 ${cumPct.toFixed(1)}%（じわじわ型 ${cumThreshold}%到達）${planText}` +
                  `\n参考: 数日かけた下落は単日急落よりリバウンドが弱いため、この深さを買い場の目安としています`,
                code: state.code,
              });

              await sendToAll(subscriptions, payload);
              console.log(`${state.code}: ${CUM_WINDOW_DAYS}営業日累計${cumPct.toFixed(1)}%(じわじわ型)を通知しました`);
            }
          }
        }
      }
    }
  }
}

async function sendToAll(subscriptions, payload) {
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
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
