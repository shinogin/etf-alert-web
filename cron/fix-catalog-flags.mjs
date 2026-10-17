// etf_catalog のレバレッジ判定・分類の誤りを修正するスクリプト(何度実行しても同じ結果になる)。
//
// 経緯(2026-10): カタログ生成時に「ブルームバーグ」の「ブル」をブル型(2倍型)と誤認し、
// 債券などの通常ETFがレバレッジ型扱いになっていた。また 606A(金2倍ブルETF)のジャンルが
// 「国内株式」になっていた。レバレッジ型はアラートの既定レベルや統計表示から外れるため、
// 誤判定のままだと本来の対象銘柄でアラートの既定値が効かない。
//
// 判定は名称と連動指数名だけで行い、変更が必要な行だけを更新してログに出す。

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("環境変数(SUPABASE_URL / SUPABASE_SERVICE_KEY)が不足しています");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const INVERSE = /インバース|ベア/;
// 「ブルームバーグ」「ブルサ(マレーシア)」「ステーブルコイン」は除外。「米ドル・ブル(1倍)」のような1倍型も除外。
const LEVERAGED = /レバレッジ|(?<!ー)ブル(?!ーム|サ)|2倍|3倍/;
const ONE_X = /1倍/;
const COMMODITY = /金価格|金レバレッジ|原油|WTI|天然ガス|プラチナ|白金|銀価格|穀物|農産物/;

function judge(e) {
  const text = `${e.name || ""} ${e.index_name || ""}`.normalize("NFKC");
  const isInverse = INVERSE.test(text);
  // インバース型(ダブルインバース等)のレバレッジ判定は元データのまま変えない
  const isLeveraged = isInverse ? e.is_leveraged : LEVERAGED.test(text) && !ONE_X.test(text);
  const category = COMMODITY.test(text) && e.category !== "コモディティ" && e.category !== "債券" ? "コモディティ" : e.category;
  let themes = Array.isArray(e.themes) ? [...e.themes] : [];
  if (!isLeveraged && !isInverse) themes = themes.filter((t) => t !== "レバレッジ");
  return { is_leveraged: isLeveraged, is_inverse: isInverse, category, themes };
}

const { data, error } = await supabase.from("etf_catalog").select("code,name,index_name,category,themes,is_leveraged,is_inverse");
if (error) {
  console.error("カタログ取得エラー:", error);
  process.exit(1);
}

let changed = 0;
for (const e of data) {
  const next = judge(e);
  const diff = {};
  for (const k of Object.keys(next)) {
    if (JSON.stringify(next[k]) !== JSON.stringify(e[k])) diff[k] = next[k];
  }
  if (Object.keys(diff).length === 0) continue;
  console.log(`${e.code} ${e.name}:`, JSON.stringify(diff));
  const { error: upErr } = await supabase.from("etf_catalog").update(diff).eq("code", e.code);
  if (upErr) {
    console.error(`  更新失敗 ${e.code}:`, upErr.message);
    process.exitCode = 1;
  } else changed++;
}
console.log(`完了: ${data.length}銘柄中 ${changed}銘柄を修正`);
