// Bluesky自動投稿スクリプト。
// bulk-crash-scan.mjs が全銘柄の前日比を更新した後に実行する想定。
// その日、既定の通知レベル(-3%)以下まで下落した銘柄があれば、上位5件を要約してBlueskyに投稿する。
// 該当銘柄が無い日は何も投稿しない(無駄な投稿でフォロワーの信頼を落とさないため)。

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const BLUESKY_HANDLE = process.env.BLUESKY_HANDLE;
const BLUESKY_APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !BLUESKY_HANDLE || !BLUESKY_APP_PASSWORD) {
  console.error(
    "環境変数(SUPABASE_URL / SUPABASE_SERVICE_KEY / BLUESKY_HANDLE / BLUESKY_APP_PASSWORD)が不足しています"
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const SITE_URL = "https://shinogin.github.io/etf-alert-web";
const ALERT_THRESHOLD = -3; // この%以下の下落だけを対象にする
const MAX_ITEMS = 10; // 表示可能な最大件数。実際に本文に入る件数は文字数制限で自動調整される

function isBusinessDayJST(date) {
  const jst = new Date(date.toLocaleString("en-US", { timeZone: "Asia/Tokyo" }));
  const day = jst.getDay();
  if (day === 0 || day === 6) return false;
  const month = jst.getMonth() + 1;
  const d = jst.getDate();
  if ((month === 12 && d === 31) || (month === 1 && d <= 3)) return false;
  return true;
}

// UTF-8バイト長を計算(Blueskyのfacetはバイトオフセットで指定する必要がある)
function byteLength(str) {
  return new TextEncoder().encode(str).length;
}

async function bskyLogin() {
  const res = await fetch("https://bsky.social/xrpc/com.atproto.server.createSession", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: BLUESKY_HANDLE, password: BLUESKY_APP_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Bluesky ログイン失敗: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

async function bskyPost(session, text, facets) {
  const res = await fetch("https://bsky.social/xrpc/com.atproto.repo.createRecord", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({
      repo: session.did,
      collection: "app.bsky.feed.post",
      record: {
        $type: "app.bsky.feed.post",
        text,
        facets,
        createdAt: new Date().toISOString(),
        langs: ["ja"],
      },
    }),
  });
  if (!res.ok) throw new Error(`投稿失敗: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// 急落が無かった週も、金曜だけは「その週の値動き」を要約して投稿する。
// 毎日ゼロ件のまま黙っているとアカウントが放置扱いされ、フォロー・検索経由の
// 露出機会を失うため、最低週1回はアクティブな状態を保つ。
async function maybePostWeeklyDigest(now) {
  const jstDay = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" })).getDay();
  if (jstDay !== 5) return; // 金曜(5)以外は何もしない

  const { data: movers } = await supabase
    .from("etf_user_state")
    .select("code, last_change_pct")
    .order("last_change_pct", { ascending: true })
    .limit(3);
  if (!movers || movers.length === 0) return;

  const codes = movers.map((s) => s.code);
  const { data: catalogRows } = await supabase
    .from("etf_catalog")
    .select("code, name")
    .in("code", codes);
  const nameByCode = {};
  (catalogRows || []).forEach((c) => (nameByCode[c.code] = c.name));
  const truncateName = (name, max = 16) =>
    Array.from(name).length > max ? Array.from(name).slice(0, max).join("") + "…" : name;

  const dateStr = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" })).toLocaleDateString(
    "ja-JP",
    { month: "long", day: "numeric" }
  );
  const link = `${SITE_URL}/etf/`;
  const HASHTAGS = ["ETF", "投資", "資産運用"];
  const tagLine = HASHTAGS.map((t) => `#${t}`).join(" ");

  let body = `${movers
    .map(
      (s) => `${s.code} ${truncateName(nameByCode[s.code] || s.code)} ${s.last_change_pct.toFixed(1)}%`
    )
    .join("\n")}`;

  const text = `📊 ${dateStr} 今週の値動き下位\n\n${body}\n\n全439銘柄の統計はこちら\n${link}\n\n${tagLine}`;

  const linkStart = byteLength(text.slice(0, text.lastIndexOf(link)));
  const linkEnd = linkStart + byteLength(link);
  const facets = [{ index: { byteStart: linkStart, byteEnd: linkEnd }, features: [{ $type: "app.bsky.richtext.facet#link", uri: link }] }];
  for (const tag of HASHTAGS) {
    const shown = `#${tag}`;
    const at = text.lastIndexOf(shown);
    if (at === -1) continue;
    const start = byteLength(text.slice(0, at));
    facets.push({ index: { byteStart: start, byteEnd: start + byteLength(shown) }, features: [{ $type: "app.bsky.richtext.facet#tag", tag }] });
  }

  const session = await bskyLogin();
  const result = await bskyPost(session, text, facets);
  console.log("週次まとめを投稿しました:", result.uri);
}

async function main() {
  const now = new Date();
  if (!isBusinessDayJST(now)) {
    console.log("非営業日のため投稿をスキップします");
    return;
  }

  const { data: states, error } = await supabase
    .from("etf_user_state")
    .select("code, last_price, last_change_pct")
    .lte("last_change_pct", ALERT_THRESHOLD)
    .order("last_change_pct", { ascending: true })
    .limit(MAX_ITEMS);

  if (error) throw error;

  if (!states || states.length === 0) {
    console.log(`本日は${ALERT_THRESHOLD}%以下の下落銘柄がないため通常投稿はスキップします`);
    await maybePostWeeklyDigest(now);
    return;
  }

  const codes = states.map((s) => s.code);
  const { data: catalogRows } = await supabase
    .from("etf_catalog")
    .select("code, name")
    .in("code", codes);
  const nameByCode = {};
  (catalogRows || []).forEach((c) => (nameByCode[c.code] = c.name));

  const dateStr = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" })).toLocaleDateString(
    "ja-JP",
    { month: "long", day: "numeric" }
  );

  // Blueskyは1投稿300グラフィームまで。銘柄名を切り詰めつつ、
  // 収まる件数だけをリストアップする(超過分は「他N件」で要約)。
  const MAX_GRAPHEMES = 290; // 安全マージン込み
  const graphemeLen = (s) => Array.from(s).length;
  const truncateName = (name, max = 18) =>
    graphemeLen(name) > max ? Array.from(name).slice(0, max).join("") + "…" : name;

  const header = `📉 ${dateStr} 下落ETF (前日比${ALERT_THRESHOLD}%以下)\n\n`;
  const link = `${SITE_URL}/etf/`;
  // ハッシュタグを付けて検索・フィード経由で発見されるようにする。
  const HASHTAGS = ["ETF", "投資", "日経平均"];
  const tagLine = HASHTAGS.map((t) => `#${t}`).join(" ");
  const footer = `\n詳細・過去統計はこちら\n${link}\n\n${tagLine}`;

  let body = "";
  let usedCount = 0;
  for (const s of states) {
    const name = truncateName(nameByCode[s.code] || s.code);
    const line = `${s.code} ${name} ${s.last_change_pct.toFixed(1)}%\n`;
    const remaining = states.length - usedCount - 1;
    const omittedNote = remaining > 0 ? `他${remaining}件\n` : "";
    if (graphemeLen(header + body + line + omittedNote + footer) > MAX_GRAPHEMES) {
      const finalOmitted = states.length - usedCount;
      body += `他${finalOmitted}件\n`;
      break;
    }
    body += line;
    usedCount++;
  }

  let text = header + body + footer;

  // Blueskyではリンクもハッシュタグもfacetで範囲指定しないと機能しない。
  // 範囲はバイトオフセットで指定する必要がある点に注意。
  const linkStart = byteLength(text.slice(0, text.lastIndexOf(link)));
  const linkEnd = linkStart + byteLength(link);
  const facets = [
    {
      index: { byteStart: linkStart, byteEnd: linkEnd },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: link }],
    },
  ];

  for (const tag of HASHTAGS) {
    const shown = `#${tag}`;
    const at = text.lastIndexOf(shown);
    if (at === -1) continue;
    const start = byteLength(text.slice(0, at));
    facets.push({
      index: { byteStart: start, byteEnd: start + byteLength(shown) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag }],
    });
  }

  const session = await bskyLogin();
  const result = await bskyPost(session, text, facets);
  console.log("Blueskyに投稿しました:", result.uri);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
