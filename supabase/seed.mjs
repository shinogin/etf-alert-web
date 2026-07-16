// 使い方: SUPABASE_URLとSUPABASE_SERVICE_KEYを環境変数に設定して
//   node seed.mjs
// を実行すると、seed-catalog.jsonの内容をetf_catalogテーブルに登録します。

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("環境変数 SUPABASE_URL / SUPABASE_SERVICE_KEY を設定してください");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const data = JSON.parse(readFileSync(new URL("./seed-catalog.json", import.meta.url)));

const { error } = await supabase.from("etf_catalog").upsert(data, { onConflict: "code" });
if (error) {
  console.error("登録エラー:", error);
  process.exit(1);
}
console.log(`${data.length}件のETFを登録しました`);
