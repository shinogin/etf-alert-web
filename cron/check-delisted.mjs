// JPX公式の「上場廃止銘柄一覧（ETF）」ページと、うちのカタログ(etf_catalog)を突き合わせ、
// 既に上場廃止になっている銘柄をカタログから除外するスクリプト。
// 月1回程度の実行を想定(頻繁に変わるものではないため)。
//
// 安全のため、削除は「関連データ(買付計画・日次履歴・通知履歴・売買記録)が一切ない銘柄」のみ
// 自動実行する。関連データが残っている銘柄は削除せず、ログに警告を出すだけにとどめる
// (ユーザーの投資記録を自動処理で消さないため)。

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("環境変数(SUPABASE_URL / SUPABASE_SERVICE_KEY)が不足しています");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const JPX_DELISTING_URL = "https://www.jpx.co.jp/equities/products/etfs/delisting/index.html";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchDelistedCodes() {
  const res = await fetch(JPX_DELISTING_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) {
    throw new Error(`JPXページ取得失敗: HTTP ${res.status}`);
  }
  const html = await res.text();

  // テーブル行から「コード」列(2番目の<td>、幅8%)だけを正確に拾う。
  // 銘柄名や上場廃止理由の文中にある数字を誤って拾わないよう、行単位でパースする。
  const rowRe = /<tr class="(?:first|end)">([\s\S]*?)<\/tr>/g;
  const codes = [];
  let m;
  while ((m = rowRe.exec(html))) {
    const rowHtml = m[1];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    const cells = [];
    let cm;
    while ((cm = cellRe.exec(rowHtml))) {
      cells.push(cm[1].replace(/&nbsp;/g, " ").trim());
    }
    // 1行目はヘッダ("コード"という文字列そのもの)なのでスキップ
    if (cells.length >= 2 && /^[0-9A-Za-z]{4,5}$/.test(cells[1]) && cells[1] !== "コード") {
      codes.push(cells[1]);
    }
  }
  return [...new Set(codes)];
}

async function hasRelatedData(code) {
  const tables = ["purchase_plan_item", "daily_price", "notification_record", "trade_record"];
  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select("code", { count: "exact", head: true })
      .eq("code", code);
    if (error) {
      // テーブルが存在しない等のエラーは「安全側」に倒して related=true 扱いにする
      console.warn(`  ${table} 確認エラー(${code}): ${error.message} → 安全のため削除スキップ対象とする`);
      return true;
    }
    if (count && count > 0) return true;
  }
  return false;
}

async function main() {
  console.log("JPX上場廃止銘柄一覧を取得中...");
  const delisted = await fetchDelistedCodes();
  console.log(`JPX上場廃止銘柄: ${delisted.length}件`);

  const { data: catalog, error } = await supabase.from("etf_catalog").select("code,name");
  if (error) {
    console.error("カタログ取得失敗:", error.message);
    process.exit(1);
  }
  const catalogCodes = new Set(catalog.map((c) => c.code));

  const overlap = delisted.filter((c) => catalogCodes.has(c));
  if (overlap.length === 0) {
    console.log("カタログ内に上場廃止銘柄は見つかりませんでした。");
    return;
  }

  console.log(`カタログ内で上場廃止と判明した銘柄: ${overlap.length}件`);
  for (const code of overlap) {
    const entry = catalog.find((c) => c.code === code);
    console.log(`- ${code} ${entry?.name || ""}`);

    const related = await hasRelatedData(code);
    if (related) {
      console.log(`  → 関連データが存在するため自動削除はスキップ(手動確認してください)`);
      continue;
    }

    const { error: delStateErr } = await supabase.from("etf_user_state").delete().eq("code", code);
    if (delStateErr) {
      console.error(`  etf_user_state削除失敗(${code}):`, delStateErr.message);
      continue;
    }
    const { error: delCatalogErr } = await supabase.from("etf_catalog").delete().eq("code", code);
    if (delCatalogErr) {
      console.error(`  etf_catalog削除失敗(${code}):`, delCatalogErr.message);
      continue;
    }
    console.log(`  → 削除完了`);
  }
}

main().catch((err) => {
  console.error("check-delisted.mjs 実行エラー:", err);
  process.exit(1);
});
