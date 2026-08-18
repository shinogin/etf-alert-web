// 全ETFの分配金データをYahoo Financeから取得してSupabaseに保存する。
// 検索クエリ分析で「(銘柄コード) 分配金」での流入が確認されたため、
// 各ETFページに分配金情報を掲載する目的で追加した。
// 分配金は月次〜年1回程度しか変動しないため、週1回の実行で十分。

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("環境変数(SUPABASE_URL / SUPABASE_SERVICE_KEY)が不足しています");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const UA = "Mozilla/5.0 (compatible; etf-alert-web/1.0)";
const SLEEP_MS = 250; // Yahoo側への負荷を抑えるための待機

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchDividends(code) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${code}.T?range=1y&interval=1d&events=div`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error("結果なし");

  const price = result.meta?.regularMarketPrice ?? null;
  const divs = result.events?.dividends;
  if (!divs || Object.keys(divs).length === 0) {
    return { annual: null, yieldPct: null, lastDate: null, lastAmount: null };
  }

  const entries = Object.entries(divs)
    .map(([ts, v]) => ({ ts: Number(ts), amount: Number(v.amount) }))
    .sort((a, b) => a.ts - b.ts);

  const annual = entries.reduce((sum, e) => sum + e.amount, 0);
  const last = entries[entries.length - 1];
  const yieldPct = price && price > 0 ? Number(((annual / price) * 100).toFixed(2)) : null;

  return {
    annual: Number(annual.toFixed(2)),
    yieldPct,
    lastDate: new Date(last.ts * 1000).toISOString().slice(0, 10),
    lastAmount: last.amount,
  };
}

async function main() {
  const { data: catalog, error } = await supabase.from("etf_catalog").select("code");
  if (error) throw error;

  console.log(`${catalog.length}銘柄の分配金を取得します...`);
  let ok = 0;
  let withDiv = 0;
  let failed = 0;

  for (const { code } of catalog) {
    try {
      const d = await fetchDividends(code);
      await supabase.from("etf_user_state").upsert(
        {
          code,
          annual_dividend: d.annual,
          dividend_yield: d.yieldPct,
          last_dividend_date: d.lastDate,
          last_dividend_amount: d.lastAmount,
          dividend_updated_at: new Date().toISOString(),
        },
        { onConflict: "code" }
      );
      ok++;
      if (d.annual != null) withDiv++;
    } catch (e) {
      failed++;
      console.warn(`  ${code}: 取得失敗 (${e.message})`);
    }
    await sleep(SLEEP_MS);
  }

  console.log(`完了: 成功${ok}件 (うち分配金あり${withDiv}件) / 失敗${failed}件`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
