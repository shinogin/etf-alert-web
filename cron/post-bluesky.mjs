// Bluesky自動投稿スクリプト。
// bulk-crash-scan.mjs が全銘柄の前日比を更新した後に実行する想定。
// 投稿は最大2本:
//  (1) 日次 — -3%以下の下落銘柄があれば一覧を、無ければ「落ち着いた一日」として当日の下位銘柄を投稿する。
//      沈黙するとアカウントが動いていないように見えるため、下落が無い日も必ず何かを発信する。
//  (2) 週次 — 金曜のみ、直近5営業日の騰落率で下位銘柄をまとめる。日次の内容にかかわらず必ず投稿する。

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
const QUIET_ITEMS = 3; // 下落銘柄が無い日に載せる「下位銘柄」の件数
const WEEKLY_ITEMS = 5; // 週次まとめに載せる件数
const BATCH_SIZE = 20; // Yahoo一括取得のバッチサイズ(bulk-crash-scan.mjsと同じ)

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

// 共通の投稿組み立て。本文はBlueskyの300グラフィーム制限に収まるよう呼び出し側で調整済みとする。
// Blueskyではリンクもハッシュタグもfacetでバイト範囲を指定しないと機能しない。
function buildFacets(text, link, hashtags) {
  const facets = [];
  if (link) {
    const linkStart = byteLength(text.slice(0, text.lastIndexOf(link)));
    facets.push({
      index: { byteStart: linkStart, byteEnd: linkStart + byteLength(link) },
      features: [{ $type: "app.bsky.richtext.facet#link", uri: link }],
    });
  }
  for (const tag of hashtags) {
    const shown = `#${tag}`;
    const at = text.lastIndexOf(shown);
    if (at === -1) continue;
    const start = byteLength(text.slice(0, at));
    facets.push({
      index: { byteStart: start, byteEnd: start + byteLength(shown) },
      features: [{ $type: "app.bsky.richtext.facet#tag", tag }],
    });
  }
  return facets;
}

function jstDateLabel(now) {
  return new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" })).toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
  });
}

function graphemeLen(s) {
  return Array.from(s).length;
}

function truncateName(name, max) {
  return graphemeLen(name) > max ? Array.from(name).slice(0, max).join("") + "…" : name;
}

async function nameMap(codes) {
  const { data } = await supabase.from("etf_catalog").select("code, name").in("code", codes);
  const map = {};
  (data || []).forEach((c) => (map[c.code] = c.name));
  return map;
}

// カタログの登録銘柄数。上場廃止などで増減するため、本文には実数を埋め込む。
async function catalogCount() {
  const { count } = await supabase.from("etf_catalog").select("code", { count: "exact", head: true });
  return count ?? 0;
}

// 直近5営業日の騰落率をYahooから取得する。
// daily_price に履歴があるのは監視銘柄(十数件)だけなので、全銘柄を対象にするには
// ここで取り直す必要がある。週1回だけの処理なのでリクエスト量は許容範囲。
async function fetchWeeklyChanges(codes) {
  const results = [];
  for (let i = 0; i < codes.length; i += BATCH_SIZE) {
    const batch = codes.slice(i, i + BATCH_SIZE);
    const symbols = batch.map((c) => `${c}.T`).join(",");
    const url = `https://query1.finance.yahoo.com/v7/finance/spark?symbols=${encodeURIComponent(
      symbols
    )}&range=5d&interval=1d`;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        },
      });
      if (!res.ok) {
        console.warn(`週次の一括取得に失敗 HTTP ${res.status} (${batch.length}銘柄)`);
        continue;
      }
      const json = await res.json();
      for (const r of json?.spark?.result ?? []) {
        const resp = r?.response?.[0];
        const code = (resp?.meta?.symbol || r.symbol || "").replace(".T", "");
        const closes = (resp?.indicators?.quote?.[0]?.close ?? []).filter((v) => typeof v === "number");
        if (closes.length < 2) continue;
        const first = closes[0];
        const last = closes[closes.length - 1];
        if (!first) continue;
        results.push({ code, changePct: ((last - first) / first) * 100, days: closes.length });
      }
    } catch (e) {
      console.warn(`週次の一括取得でエラー (${batch.length}銘柄):`, e.message);
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return results;
}

// 金曜のその週のまとめ。日次投稿の有無にかかわらず必ず実行する。
// (以前は「-3%以下の下落が無い金曜」だけに出していたため、荒れた週ほど週次が出ないという
//  本末転倒な挙動になっていた)
async function postWeeklyDigest(session, now) {
  const { data: catalog } = await supabase.from("etf_catalog").select("code");
  const codes = (catalog || []).map((c) => c.code);
  if (codes.length === 0) return;

  const changes = await fetchWeeklyChanges(codes);
  if (changes.length === 0) {
    console.log("週次: 騰落率を取得できなかったため投稿しません");
    return;
  }

  changes.sort((a, b) => a.changePct - b.changePct);
  const losers = changes.slice(0, WEEKLY_ITEMS);
  const names = await nameMap(losers.map((s) => s.code));
  const total = changes.length;
  const downCount = changes.filter((c) => c.changePct < 0).length;

  const link = `${SITE_URL}/etf/`;
  const HASHTAGS = ["ETF", "投資", "資産運用"];
  const tagLine = HASHTAGS.map((t) => `#${t}`).join(" ");

  const body = losers
    .map((s) => `${s.code} ${truncateName(names[s.code] || s.code, 16)} ${s.changePct.toFixed(1)}%`)
    .join("\n");

  const text =
    `📊 ${jstDateLabel(now)} 今週の下落ETF (5営業日)\n\n${body}\n\n` +
    `全${total}銘柄中 ${downCount}銘柄が下落\n${link}\n\n${tagLine}`;

  const result = await bskyPost(session, text, buildFacets(text, link, HASHTAGS));
  console.log("週次まとめを投稿しました:", result.uri);
}

// -3%以下の下落が無かった日の投稿。
// 「何も無かった」だけでは情報量が乏しいので、その日の下位銘柄を添えて相場の温度感を伝える。
async function postQuietDay(session, now) {
  const { data: movers } = await supabase
    .from("etf_user_state")
    .select("code, last_change_pct")
    .not("last_change_pct", "is", null)
    .order("last_change_pct", { ascending: true })
    .limit(QUIET_ITEMS);
  if (!movers || movers.length === 0) {
    console.log("下位銘柄を取得できなかったため投稿しません");
    return;
  }

  const names = await nameMap(movers.map((s) => s.code));
  const total = await catalogCount();
  const link = `${SITE_URL}/etf/`;
  const HASHTAGS = ["ETF", "投資", "資産運用"];
  const tagLine = HASHTAGS.map((t) => `#${t}`).join(" ");

  const body = movers
    .map((s) => `${s.code} ${truncateName(names[s.code] || s.code, 16)} ${s.last_change_pct.toFixed(1)}%`)
    .join("\n");

  const text =
    `☀️ ${jstDateLabel(now)} 本日${ALERT_THRESHOLD}%以上下げたETFはありません\n\n` +
    `下落率が大きかった銘柄\n${body}\n\n全${total}銘柄の統計はこちら\n${link}\n\n${tagLine}`;

  const result = await bskyPost(session, text, buildFacets(text, link, HASHTAGS));
  console.log("下落なしの日として投稿しました:", result.uri);
}

async function main() {
  const now = new Date();
  if (!isBusinessDayJST(now)) {
    console.log("非営業日のため投稿をスキップします");
    return;
  }

  const session = await bskyLogin();

  const { data: states, error } = await supabase
    .from("etf_user_state")
    .select("code, last_price, last_change_pct")
    .lte("last_change_pct", ALERT_THRESHOLD)
    .order("last_change_pct", { ascending: true })
    .limit(MAX_ITEMS);
  if (error) throw error;

  if (!states || states.length === 0) {
    console.log(`本日は${ALERT_THRESHOLD}%以下の下落銘柄がありません`);
    await postQuietDay(session, now);
  } else {
    await postDailyDrops(session, now, states);
  }

  // 金曜は日次の内容にかかわらず週次まとめも投稿する。
  const jstDay = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Tokyo" })).getDay();
  if (jstDay === 5) {
    // 日次投稿の直後だとタイムラインで前後してしまうため少し間隔を空ける。
    await new Promise((r) => setTimeout(r, 5000));
    await postWeeklyDigest(session, now);
  }
}

// -3%以下の下落銘柄がある日の投稿。
async function postDailyDrops(session, now, states) {
  const nameByCode = await nameMap(states.map((s) => s.code));
  const dateStr = jstDateLabel(now);

  // Blueskyは1投稿300グラフィームまで。銘柄名を切り詰めつつ、
  // 収まる件数だけをリストアップする(超過分は「他N件」で要約)。
  const MAX_GRAPHEMES = 290; // 安全マージン込み

  const header = `📉 ${dateStr} 下落ETF (前日比${ALERT_THRESHOLD}%以下)\n\n`;
  const link = `${SITE_URL}/etf/`;
  // ハッシュタグを付けて検索・フィード経由で発見されるようにする。
  const HASHTAGS = ["ETF", "投資", "日経平均"];
  const tagLine = HASHTAGS.map((t) => `#${t}`).join(" ");
  const footer = `\n詳細・過去統計はこちら\n${link}\n\n${tagLine}`;

  let body = "";
  let usedCount = 0;
  for (const s of states) {
    const name = truncateName(nameByCode[s.code] || s.code, 18);
    const line = `${s.code} ${name} ${s.last_change_pct.toFixed(1)}%\n`;
    const remaining = states.length - usedCount - 1;
    const omittedNote = remaining > 0 ? `他${remaining}件\n` : "";
    if (graphemeLen(header + body + line + omittedNote + footer) > MAX_GRAPHEMES) {
      body += `他${states.length - usedCount}件\n`;
      break;
    }
    body += line;
    usedCount++;
  }

  const text = header + body + footer;
  const result = await bskyPost(session, text, buildFacets(text, link, HASHTAGS));
  console.log("Blueskyに投稿しました:", result.uri);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
