// 全ETFカタログを対象にした「大暴落」検知スクリプト。
// 監視フラグに関係なく全銘柄をスキャンし、前日比が閾値を超えて急落した銘柄のみ
// etf_user_state.last_price / last_change_pct を更新する(is_watched/is_favoriteは変更しない)。
// 監視銘柄向けのcheck-prices.mjsとは別に、1日1回(市場終了後)だけ実行する想定。
// 理由: Yahoo Financeの一括取得エンドポイント(v7/finance/spark)は1回あたり約20銘柄が上限のため、
// 全件(400件超)を頻繁に叩くとレート制限やブロックのリスクが高まる。

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("環境変数(SUPABASE_URL / SUPABASE_SERVICE_KEY)が不足しています");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// 「大暴落」とみなす閾値。通常の監視レベル(-3/-5/-7/-10%)よりさらに深い、
// 数年に一度レベルの急落のみ拾う。
const CRASH_THRESHOLD = -15;
const BATCH_SIZE = 20;

function isBusinessDayJST(date) {
  const jst = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const day = jst.getDay();
  if (day === 0 || day === 6) return false;
  const month = jst.getMonth() + 1;
  const d = jst.getDate();
  if ((month === 12 && d === 31) || (month === 1 && d <= 3)) return false;
  return true;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function fetchSparkBatch(codes) {
  const symbols = codes.map((c) => `${c}.T`).join(",");
  const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(
    symbols
  )}&range=1d&interval=1d`;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
    });
    if (!res.ok) {
      console.warn(`一括取得失敗 HTTP ${res.status} (${codes.length}銘柄)`);
      return [];
    }
    const json = await res.json();
    const results = json?.spark?.result ?? [];
    return results
      .map((r) => {
        const meta = r?.response?.[0]?.meta;
        const code = (meta?.symbol || r.symbol || "").replace(".T", "");
        const price = meta?.regularMarketPrice;
        const prevClose = meta?.chartPreviousClose ?? meta?.previousClose;
        if (typeof price !== "number" || typeof prevClose !== "number" || !prevClose) return null;
        const changePct = ((price - prevClose) / prevClose) * 100;
        return { code, price, changePct };
      })
      .filter(Boolean);
  } catch (e) {
    console.warn("一括取得エラー:", e.message);
    return [];
  }
}

async function main() {
  const now = new Date();
  if (!isBusinessDayJST(now)) {
    console.log("非営業日のためスキップします");
    return;
  }

  const { data: catalog, error } = await supabase.from("etf_catalog").select("code");
  if (error) {
    console.error("カタログ取得エラー:", error);
    process.exit(1);
  }
  if (!catalog || catalog.length === 0) {
    console.log("カタログが空です");
    return;
  }

  const codes = catalog.map((c) => c.code);
  const batches = chunk(codes, BATCH_SIZE);
  console.log(`全${codes.length}銘柄を${batches.length}バッチでスキャンします`);

  let crashCount = 0;
  for (const batch of batches) {
    const quotes = await fetchSparkBatch(batch);
    for (const q of quotes) {
      if (q.changePct <= CRASH_THRESHOLD) {
        crashCount++;
        console.log(`🔴 大暴落検知: ${q.code} ${q.changePct.toFixed(1)}%`);
        await supabase
          .from("etf_user_state")
          .upsert(
            { code: q.code, last_price: q.price, last_change_pct: q.changePct, last_updated_at: now.toISOString() },
            { onConflict: "code", ignoreDuplicates: false }
          );
      }
    }
    // レート制限回避のため少し待機
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log(`スキャン完了。大暴落検知件数: ${crashCount}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
