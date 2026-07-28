// 公開ページの自動生成スクリプト。
// Supabaseから ETFカタログ・現在価格・売買記録 を取得し、
// GitHub Pages で公開する静的HTMLを web/etf/ 以下に書き出す。
// 検索流入 → A8.netアフィリエイトリンクへの導線を作ることが目的。
// このスクリプトはSupabaseへの書き込みは一切行わない(読み取り専用)。

import { createClient } from "@supabase/supabase-js";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("環境変数(SUPABASE_URL / SUPABASE_SERVICE_KEY)が不足しています");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const OUT_ROOT = "../web";
const SITE_URL = "https://shinogin.github.io/etf-alert-web";

// アフィリエイトリンク設定を読み込む。urlが空の証券会社は表示しない。
// (A8.netで提携承認が下りるまでは全て空 = 広告は一切表示されない状態)
function loadActiveBrokers() {
  try {
    const raw = JSON.parse(readFileSync("./affiliate-links.json", "utf-8"));
    return (raw.brokers || []).filter((b) => b.url && b.url.trim() !== "");
  } catch (e) {
    console.warn("affiliate-links.json の読み込みに失敗(広告なしで続行):", e.message);
    return [];
  }
}
const ACTIVE_BROKERS = loadActiveBrokers();

function affiliateBlockHtml() {
  if (ACTIVE_BROKERS.length === 0) return "";
  const links = ACTIVE_BROKERS.map(
    (b) =>
      `<a class="cta" style="background:#8882;color:inherit !important;" href="${esc(
        b.url
      )}" rel="nofollow sponsored" target="_blank">［PR］${esc(b.name)}で口座開設</a>`
  ).join("\n");
  return `<h2>証券口座をお持ちでない方へ</h2>\n${links}\n<p style="font-size:11px;opacity:0.55;">［PR］上記はアフィリエイト広告を含みます。当サイトは投資助言を行うものではありません。</p>`;
}

// ---------- ユーティリティ ----------
function esc(s) {
  if (s == null) return "";
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function yen(n) {
  if (n == null) return "—";
  return (n < 0 ? "−" : "") + "¥" + Math.abs(Math.round(n)).toLocaleString();
}
function pct(n, digits = 2) {
  if (n == null) return "—";
  return (n > 0 ? "+" : "") + Number(n).toFixed(digits) + "%";
}
function aumText(aum) {
  if (aum == null) return "—";
  if (aum >= 1e12) return (aum / 1e12).toFixed(1) + "兆円";
  return Math.round(aum / 1e8).toLocaleString() + "億円";
}
function todayJST() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// このアプリの通知ロジック(Blueprint §5.1)が使う既定レベル。
// 個別ページの「参考統計」表示に使う簡易バックテスト値。
// 実データが蓄積したら trade_stats を優先表示する。
const GENERIC_REBOUND_STATS = {
  "-2": { win: 73, avg: 1.5 },
  "-3": { win: 61, avg: 0.5 },
  "-5": { win: 59, avg: 1.5 },
  "-7": { win: 100, avg: 12, note: "※過去7回のみ・参考値" },
};

function pageLayout({ title, description, canonical, bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta name="robots" content="index,follow" />
<style>
  :root { color-scheme: light dark; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; margin: 0; padding: 0 16px 60px; max-width: 720px; margin-inline: auto; line-height: 1.7; }
  header { padding: 16px 0; border-bottom: 1px solid #8883; }
  header a { text-decoration: none; color: inherit; font-weight: 700; font-size: 15px; }
  h1 { font-size: 20px; margin: 16px 0 4px; }
  h2 { font-size: 16px; margin: 24px 0 8px; border-left: 4px solid #333; padding-left: 8px; }
  .code { opacity: 0.6; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; margin: 8px 0; }
  td, th { padding: 8px 6px; border-bottom: 1px solid #8882; text-align: left; }
  th { opacity: 0.65; font-weight: 500; width: 40%; }
  .pct-down { color: #d33; } .pct-up { color: #2a8a4a; }
  .chip { display:inline-block; font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #8882; margin: 2px 4px 2px 0; }
  .cta { display: block; text-align: center; background: #333; color: #fff !important; padding: 14px; border-radius: 10px; font-weight: 700; margin: 20px 0; text-decoration: none; }
  .note { font-size: 12px; opacity: 0.6; margin-top: 24px; border-top: 1px solid #8883; padding-top: 12px; }
  footer { margin-top: 40px; font-size: 12px; opacity: 0.6; text-align: center; }
  a.back { font-size: 13px; opacity: 0.7; }
  .list-row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #8882; font-size: 14px; text-decoration: none; color: inherit; }
  .list-row .n { flex: 1; }
  .list-row .c { opacity: 0.55; font-size: 12px; margin-left: 8px; }
</style>
</head>
<body>
<header><a href="${SITE_URL}/etf/">ETF下落統計データベース</a></header>
${bodyHtml}
<footer>
  自動生成日時: ${new Date().toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })} JST<br/>
  本サイトは投資助言を行うものではありません。掲載情報は過去のデータであり、将来の運用成果を保証するものではありません。<br/>
  投資判断はご自身の責任で行ってください。
</footer>
</body>
</html>`;
}

// ---------- データ取得 ----------
async function fetchAll(table, select) {
  const pageSize = 1000;
  let from = 0;
  let out = [];
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    out = out.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

async function main() {
  console.log("データ取得中...");
  const catalog = await fetchAll(
    "etf_catalog",
    "code,name,nickname,issuer,index_name,category,themes,is_leveraged,is_inverse,expense_ratio,aum"
  );
  const states = await fetchAll(
    "etf_user_state",
    "code,last_price,last_change_pct,last_updated_at,last_volume,last_turnover"
  );
  const { data: statsRows } = await supabase.from("trade_stats").select("*").limit(1);
  const trades = await fetchAll(
    "trade_record",
    "code,name,position_type,alert_level,entry_date,entry_price,quantity,exit_date,exit_price,pnl,return_pct,holding_days,is_closed,memo"
  );
  const stats = (statsRows && statsRows[0]) || {};

  const stateByCode = {};
  states.forEach((s) => (stateByCode[s.code] = s));

  mkdirSync(`${OUT_ROOT}/etf`, { recursive: true });

  // ---------- 個別ETFページ ----------
  console.log(`ETF個別ページ生成中... (${catalog.length}件)`);
  for (const e of catalog) {
    const s = stateByCode[e.code] || {};
    const changeCls = s.last_change_pct < 0 ? "pct-down" : "pct-up";
    const chips = [
      e.category,
      e.is_leveraged ? "レバレッジ型" : null,
      e.is_inverse ? "インバース型" : null,
      ...(e.themes || []),
    ]
      .filter(Boolean)
      .map((t) => `<span class="chip">${esc(t)}</span>`)
      .join("");

    const reboundRows = Object.entries(GENERIC_REBOUND_STATS)
      .map(
        ([lvl, v]) =>
          `<tr><td>${lvl}%到達</td><td>勝率${v.win}%・平均${v.avg > 0 ? "+" : ""}${v.avg}%${
            v.note ? `<br/><small>${esc(v.note)}</small>` : ""
          }</td></tr>`
      )
      .join("");

    const title = `${e.name}（${e.code}）下落統計・信託報酬・純資産｜ETF下落統計データベース`;
    const description = `${e.name}(${e.code})の信託報酬${e.expense_ratio}%・純資産${aumText(
      e.aum
    )}・前日比${pct(s.last_change_pct, 1)}。下落局面での過去統計を無料で公開。`;

    const body = `
<h1>${esc(e.name)}</h1>
<div class="code">証券コード: ${esc(e.code)}　${e.nickname ? `愛称: ${esc(e.nickname)}` : ""}</div>
<div style="margin:8px 0;">${chips}</div>

<h2>基本情報</h2>
<table>
  <tr><th>運用会社</th><td>${esc(e.issuer)}</td></tr>
  <tr><th>連動指数</th><td>${esc(e.index_name)}</td></tr>
  <tr><th>信託報酬</th><td>${e.expense_ratio}%</td></tr>
  <tr><th>純資産総額</th><td>${aumText(e.aum)}</td></tr>
</table>

<h2>現在の価格</h2>
<table>
  <tr><th>直近価格</th><td>${s.last_price != null ? s.last_price.toLocaleString() + "円" : "データ取得中"}</td></tr>
  <tr><th>前日比</th><td class="${changeCls}">${pct(s.last_change_pct, 2)}</td></tr>
  <tr><th>売買代金(参考)</th><td>${s.last_turnover ? yen(s.last_turnover) + "/日" : "—"}</td></tr>
  <tr><th>更新時刻</th><td>${s.last_updated_at ? new Date(s.last_updated_at).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—"}</td></tr>
</table>

<h2>下落後リバウンド統計（参考値）</h2>
<table>${reboundRows}</table>
<p style="font-size:12px;opacity:0.6;">大型・主要指数連動ETFの過去傾向に基づく参考値です。個別銘柄・時期により結果は大きく異なります。投資助言ではありません。</p>

<a class="cta" href="${SITE_URL}/?code=${esc(e.code)}">アプリでこの銘柄を監視・通知登録する</a>

${affiliateBlockHtml()}

<a class="back" href="${SITE_URL}/etf/">← 一覧に戻る</a>
`;

    const html = pageLayout({
      title,
      description,
      canonical: `${SITE_URL}/etf/${e.code}/`,
      bodyHtml: body,
    });
    mkdirSync(`${OUT_ROOT}/etf/${e.code}`, { recursive: true });
    writeFileSync(`${OUT_ROOT}/etf/${e.code}/index.html`, html);
  }

  // ---------- 一覧ページ ----------
  console.log("一覧ページ生成中...");
  const sorted = [...catalog].sort((a, b) => a.code.localeCompare(b.code));
  const rows = sorted
    .map((e) => {
      const s = stateByCode[e.code] || {};
      return `<a class="list-row" href="${SITE_URL}/etf/${e.code}/"><span class="n">${esc(
        e.name
      )}</span><span class="c">${e.code} / ${pct(s.last_change_pct, 1)}</span></a>`;
    })
    .join("\n");

  const listBody = `
<h1>日本ETF 下落統計データベース（全${catalog.length}銘柄）</h1>
<p style="font-size:14px;">日本上場の全ETFについて、信託報酬・純資産・下落後のリバウンド統計を毎日自動更新しています。</p>
<a class="cta" href="${SITE_URL}/jisseki/">実際の売買記録・成績を見る</a>
${rows}
`;
  writeFileSync(
    `${OUT_ROOT}/etf/index.html`,
    pageLayout({
      title: `日本ETF下落統計データベース（全${catalog.length}銘柄・毎日自動更新）`,
      description: `日本上場ETF全${catalog.length}銘柄の信託報酬・純資産・下落統計を無料公開。`,
      canonical: `${SITE_URL}/etf/`,
      bodyHtml: listBody,
    })
  );

  // ---------- 実績（売買記録）ページ ----------
  console.log("実績ページ生成中...");
  const closedTrades = trades.filter((t) => t.is_closed).sort((a, b) => (a.exit_date < b.exit_date ? 1 : -1));
  const openTrades = trades.filter((t) => !t.is_closed);

  const tradeRows = closedTrades
    .map((t) => {
      const cls = t.pnl > 0 ? "pct-up" : t.pnl < 0 ? "pct-down" : "";
      return `<tr>
        <td>${esc(t.code)} ${esc(t.name || "")}</td>
        <td>${t.entry_date}→${t.exit_date}</td>
        <td>${t.holding_days}日</td>
        <td class="${cls}">${pct(t.return_pct, 1)}</td>
      </tr>`;
    })
    .join("");

  const jissekiBody = `
<h1>実際の売買記録・成績</h1>
<p style="font-size:14px;">このアプリの下落通知をもとに、運営者自身が実際に行った信用取引の記録です。全件をありのまま公開しています。</p>

<h2>サマリー（決済済み ${stats.closed_trades ?? 0}件）</h2>
<table>
  <tr><th>勝率</th><td>${stats.win_rate_pct != null ? stats.win_rate_pct + "%" : "データなし"}</td></tr>
  <tr><th>確定損益合計</th><td class="${stats.total_pnl > 0 ? "pct-up" : stats.total_pnl < 0 ? "pct-down" : ""}">${yen(stats.total_pnl)}</td></tr>
  <tr><th>平均リターン</th><td>${pct(stats.avg_return_pct, 2)}</td></tr>
  <tr><th>平均保有日数</th><td>${stats.avg_holding_days != null ? stats.avg_holding_days + "日" : "—"}</td></tr>
  <tr><th>保有中</th><td>${openTrades.length}件</td></tr>
</table>

<h2>決済済み取引の一覧</h2>
<table>
  <tr><th>銘柄</th><th>期間</th><th>保有</th><th>リターン</th></tr>
  ${tradeRows || '<tr><td colspan="4">まだ決済済みの記録がありません</td></tr>'}
</table>

${affiliateBlockHtml()}

<div class="note">
  本ページは投資助言ではなく、運営者個人の取引記録の開示です。過去の成績は将来の成果を保証しません。<br/>
  信用取引には元本超過損のリスクがあります。
</div>
`;
  mkdirSync(`${OUT_ROOT}/jisseki`, { recursive: true });
  writeFileSync(
    `${OUT_ROOT}/jisseki/index.html`,
    pageLayout({
      title: "実際の売買記録・成績公開｜ETF下落統計データベース",
      description: "ETF下落通知アプリの運営者が実際に行った信用取引の全記録を公開。",
      canonical: `${SITE_URL}/jisseki/`,
      bodyHtml: jissekiBody,
    })
  );

  // ---------- sitemap.xml ----------
  console.log("sitemap.xml生成中...");
  const urls = [
    `${SITE_URL}/`,
    `${SITE_URL}/etf/`,
    `${SITE_URL}/jisseki/`,
    ...sorted.map((e) => `${SITE_URL}/etf/${e.code}/`),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>`;
  writeFileSync(`${OUT_ROOT}/sitemap.xml`, sitemap);

  console.log(`完了: ETFページ${catalog.length}件 + 一覧 + 実績ページ + sitemap.xml`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
