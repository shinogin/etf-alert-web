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
    const raw = JSON.parse(readFileSync(`${OUT_ROOT}/affiliate-links.json`, "utf-8"));
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

// 過去10年バックテスト(流動性フィルター後、分割等の異常値除外)による
// カテゴリ×通知レベル×経過営業日ごとの勝率(win,%)・平均リターン(avg,%)・中央値リターン(med,%)・サンプル数(n)。
// web/js/app.js および cron/check-prices.mjs と同一データ(出典: 2026-07実施のバックテスト)。
const REBOUND_MATRIX = {"index": {"-3": {"10": {"n": 1472, "win": 65.5, "avg": 1.5, "med": 2.3}, "15": {"n": 1467, "win": 65.6, "avg": 2.1, "med": 2.7}, "20": {"n": 1454, "win": 70.1, "avg": 3.7, "med": 3.3}, "30": {"n": 1436, "win": 74.0, "avg": 4.9, "med": 5.3}, "63": {"n": 1411, "win": 79.9, "avg": 9.5, "med": 9.5}}, "-5": {"10": {"n": 326, "win": 70.6, "avg": 3.5, "med": 4.8}, "15": {"n": 325, "win": 69.8, "avg": 5.0, "med": 6.0}, "20": {"n": 324, "win": 77.2, "avg": 6.9, "med": 7.9}, "30": {"n": 321, "win": 76.3, "avg": 7.4, "med": 8.2}, "63": {"n": 319, "win": 88.7, "avg": 14.5, "med": 16.1}}, "-8": {"10": {"n": 72, "win": 81.9, "avg": 7.3, "med": 7.7}, "15": {"n": 72, "win": 81.9, "avg": 10.0, "med": 11.9}, "20": {"n": 72, "win": 84.7, "avg": 12.0, "med": 15.4}, "30": {"n": 72, "win": 86.1, "avg": 11.1, "med": 14.3}, "63": {"n": 72, "win": 87.5, "avg": 18.5, "med": 24.2}}}, "theme": {"-3": {"10": {"n": 4939, "win": 59.9, "avg": 1.1, "med": 1.6}, "15": {"n": 4907, "win": 59.7, "avg": 1.5, "med": 1.7}, "20": {"n": 4882, "win": 60.6, "avg": 2.3, "med": 2.3}, "30": {"n": 4825, "win": 61.1, "avg": 2.6, "med": 2.7}, "63": {"n": 4657, "win": 66.3, "avg": 6.8, "med": 5.4}}, "-7": {"10": {"n": 600, "win": 63.0, "avg": 2.2, "med": 3.8}, "15": {"n": 593, "win": 65.4, "avg": 3.6, "med": 5.7}, "20": {"n": 590, "win": 65.9, "avg": 4.5, "med": 5.9}, "30": {"n": 583, "win": 64.8, "avg": 3.5, "med": 6.3}, "63": {"n": 575, "win": 65.2, "avg": 8.2, "med": 8.3}}, "-10": {"10": {"n": 242, "win": 69.0, "avg": 4.3, "med": 6.9}, "15": {"n": 241, "win": 68.5, "avg": 5.8, "med": 11.4}, "20": {"n": 241, "win": 68.9, "avg": 6.9, "med": 11.3}, "30": {"n": 240, "win": 68.3, "avg": 5.4, "med": 10.4}, "63": {"n": 240, "win": 68.3, "avg": 10.9, "med": 11.2}}}};
const REBOUND_HORIZON_LABELS = { "10": "10営業日", "15": "15営業日", "20": "20営業日", "30": "30営業日", "63": "63営業日(約3ヶ月)" };

// 広範な指数に連動するETFは値動きが穏やかなため浅めの閾値、
// テーマ・セクター型は振れ幅が大きいため深めの閾値を既定とする。
const INDEX_DEFAULT_LEVELS = [-3, -5, -8];
const THEME_DEFAULT_LEVELS = [-3, -7, -10];
const BROAD_INDEX_KEYWORDS = [
  "TOPIX", "日経225", "日経平均", "日経３００", "日経300",
  "JPX日経400", "JPX 日経 400", "JPXプライム150", "JPX日経インデックス400",
  "S&P500", "S&P 500", "NYダウ", "ダウ工業", "ナスダック100", "NASDAQ100", "NASDAQ-100",
  "MSCI ACWI", "MSCI-KOKUSAI", "MSCIコクサイ", "MSCI コクサイ",
  "FTSE 100", "DAX", "CSI300", "MSCIエマージング", "MSCI エマージング",
];

function categoryDefaultLevels(entry) {
  // レバレッジ・インバース型は値動きの性質が異なるためバックテスト対象外
  if (!entry || entry.is_leveraged || entry.is_inverse) return null;
  const idx = entry.index_name || "";
  const isBroadIndex = BROAD_INDEX_KEYWORDS.some((kw) => idx.includes(kw));
  return isBroadIndex ? INDEX_DEFAULT_LEVELS : THEME_DEFAULT_LEVELS;
}

// 分配金セクションを生成する。
// 「(銘柄コード) 分配金」という検索需要が実際に確認されたため設置している。
// 分配金実績がない銘柄(無分配型など)はその旨を明示する。
function dividendSection(entry, state) {
  const s = state || {};
  if (s.annual_dividend == null) {
    return `<h2>分配金</h2>
<p style="font-size:13px;">直近1年間の分配金実績は確認できませんでした。無分配型のETFであるか、設定から間もない可能性があります。</p>`;
  }
  return `<h2>分配金</h2>
<table>
  <tr><th>直近1年の分配金合計</th><td>${s.annual_dividend}円</td></tr>
  <tr><th>分配金利回り(参考)</th><td>${s.dividend_yield != null ? s.dividend_yield + "%" : "—"}</td></tr>
  <tr><th>直近の分配金</th><td>${s.last_dividend_amount != null ? s.last_dividend_amount + "円" : "—"}</td></tr>
  <tr><th>直近の支払日</th><td>${s.last_dividend_date || "—"}</td></tr>
</table>
<p style="font-size:12px;opacity:0.6;">直近1年間に支払われた分配金の実績値です。利回りは「直近1年の分配金合計 ÷ 現在価格」で算出した参考値で、将来の分配金を保証するものではありません。税金は考慮していません。</p>`;
}

// 銘柄ごとのリバウンド統計表を生成する。
// 対象外(レバレッジ/インバース)の場合は空文字を返し、セクションごと非表示にする。
function relatedSection(entry, catalog, stateByCode) {
  const themes = new Set(entry.themes || []);
  const scored = catalog
    .filter((o) => o.code !== entry.code)
    .map((o) => {
      let score = 0;
      if (o.category === entry.category) score += 3;
      if (o.index_name && o.index_name === entry.index_name) score += 4;
      (o.themes || []).forEach((t) => { if (themes.has(t)) score += 2; });
      if (o.is_leveraged === entry.is_leveraged) score += 1;
      if (o.is_inverse === entry.is_inverse) score += 1;
      return { o, score, aum: o.aum || 0 };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score || b.aum - a.aum)
    .slice(0, 8);
  if (!scored.length) return "";
  const rows = scored
    .map(({ o }) => {
      const st = stateByCode[o.code] || {};
      const cls = st.last_change_pct < 0 ? "pct-down" : "pct-up";
      return `  <tr><td><a href="${SITE_URL}/etf/${esc(o.code)}/">${esc(o.name)}</a><br/><span class="code">${esc(o.code)}</span></td><td>${o.expense_ratio}%</td><td>${aumText(o.aum)}</td><td class="${cls}">${pct(st.last_change_pct, 2)}</td></tr>`;
    })
    .join("\n");
  return `<h2>${esc(entry.name)}と似た特徴を持つETF</h2>
<p style="font-size:13px;opacity:0.8;">同じジャンル・連動指数・テーマのETFです。信託報酬や純資産を比較して検討できます。</p>
<table>
  <tr><th>銘柄</th><th>信託報酬</th><th>純資産</th><th>前日比</th></tr>
${rows}
</table>`;
}

function reboundStatsSection(entry) {
  const levels = categoryDefaultLevels(entry);
  if (!levels) {
    return `<h2>下落後リバウンド統計</h2>
<p style="font-size:13px;">レバレッジ型・インバース型は値動きの性質が通常のETFと大きく異なるため、統計の対象外としています。</p>`;
  }
  const group = levels === THEME_DEFAULT_LEVELS ? "theme" : "index";
  const groupLabel = group === "theme" ? "テーマ・セクター型" : "主要指数連動型";

  const headerCells = Object.values(REBOUND_HORIZON_LABELS)
    .map((label) => `<th>${label}</th>`)
    .join("");

  const rows = levels
    .slice()
    .sort((a, b) => a - b)
    .map((level) => {
      const byHorizon = REBOUND_MATRIX[group]?.[String(level)];
      if (!byHorizon) return "";
      const cells = Object.keys(REBOUND_HORIZON_LABELS)
        .map((d) => {
          const st = byHorizon[d];
          if (!st) return `<td>—</td>`;
          return `<td style="white-space:nowrap;">勝率 ${st.win}%<br/><small>平均 ${st.avg}% / 中央値 ${st.med}%</small></td>`;
        })
        .join("");
      const n = byHorizon["63"]?.n ?? byHorizon["10"]?.n;
      return `<tr><th style="width:auto;">${level}%到達<br/><small>n=${n}</small></th>${cells}</tr>`;
    })
    .join("");

  return `<h2>下落後リバウンド統計</h2>
<p style="font-size:13px;">この銘柄は<strong>${esc(groupLabel)}</strong>に分類されます。過去10年の東証上場ETFを対象に、前日比が各水準まで下落した日を起点として、その後の値動きを集計した結果です。「勝率」は起点の価格を上回った割合を指します。</p>
<div style="overflow-x:auto;">
<table>
  <tr><th style="width:auto;">下落水準</th>${headerCells}</tr>
  ${rows}
</table>
</div>
<p style="font-size:12px;opacity:0.6;">n=サンプル数。分割等による異常値を除外し、流動性の低い銘柄を除いた上で集計しています。同一分類の銘柄群を対象とした統計であり、この銘柄個別の実績ではありません。過去の傾向は将来の成果を保証しません。</p>`;
}

function pageLayout({ title, description, canonical, bodyHtml, ogType, jsonLd }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}" />
<link rel="canonical" href="${esc(canonical)}" />
<meta name="robots" content="index,follow" />
<meta property="og:type" content="${ogType || "website"}" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(description)}" />
<meta property="og:url" content="${esc(canonical)}" />
<meta property="og:site_name" content="ETF下落統計データベース" />
<meta property="og:locale" content="ja_JP" />
<meta name="twitter:card" content="summary" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(description)}" />${
  jsonLd
    ? `\n<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
    : ""
}
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
// ---------- 銘柄固有の下落ヒストリ(Yahoo Finance) ----------
// 分類共通のリバウンド統計とは別に、その銘柄自身の過去2年の実データを集計する。
// 分割は adjclose で調整し、それでも残る異常値(±30%超)は Blueprint §10 に従い除外する。
const YF_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const OWN_MIN_SAMPLES = 5;
const OWN_HORIZONS = [10, 20];

async function fetchOwnHistory(code) {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${code}.T?range=2y&interval=1d`,
      { headers: { "User-Agent": YF_UA } }
    );
    if (!res.ok) return null;
    const r = (await res.json()).chart?.result?.[0];
    if (!r) return null;
    const ts = r.timestamp || [];
    const px = r.indicators?.adjclose?.[0]?.adjclose || r.indicators?.quote?.[0]?.close || [];
    return ts
      .map((t, i) => ({ d: new Date(t * 1000).toISOString().slice(0, 10), c: px[i] }))
      .filter((x) => x.c != null && x.c > 0);
  } catch (e) {
    return null;
  }
}

function ownDropStats(rows, threshold) {
  if (!rows || rows.length < 60) return null;
  const events = [];
  for (let i = 1; i < rows.length; i++) {
    const chg = ((rows[i].c - rows[i - 1].c) / rows[i - 1].c) * 100;
    if (!isFinite(chg) || Math.abs(chg) > 30) continue;
    if (chg <= threshold) events.push({ i, date: rows[i].d, chg: +chg.toFixed(2), close: rows[i].c });
  }
  const out = { count: events.length, latest: events[events.length - 1] || null, horizons: {} };
  for (const h of OWN_HORIZONS) {
    const rets = events
      .filter((e) => e.i + h < rows.length)
      .map((e) => ((rows[e.i + h].c - e.close) / e.close) * 100)
      .filter((r) => isFinite(r) && Math.abs(r) <= 100);
    if (rets.length < OWN_MIN_SAMPLES) { out.horizons[h] = null; continue; }
    rets.sort((a, b) => a - b);
    out.horizons[h] = {
      n: rets.length,
      win: +((rets.filter((r) => r > 0).length / rets.length) * 100).toFixed(1),
      avg: +(rets.reduce((a, b) => a + b, 0) / rets.length).toFixed(2),
      med: +rets[Math.floor(rets.length / 2)].toFixed(2),
    };
  }
  return out;
}

async function fetchAllOwnStats(catalog) {
  const results = {};
  let idx = 0, ok = 0, fail = 0;
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= catalog.length) return;
      const e = catalog[i];
      const rows = await fetchOwnHistory(e.code);
      if (!rows) { fail++; continue; }
      ok++;
      const threshold = e.is_leveraged || e.is_inverse ? -5 : -3;
      results[e.code] = { threshold, stats: ownDropStats(rows, threshold) };
      await new Promise((r) => setTimeout(r, 60));
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log(`銘柄固有ヒストリ: 成功${ok}件 / 失敗${fail}件`);
  return results;
}
function ownHistorySection(entry, own) {
  if (!own || !own.stats) return "";
  const { threshold, stats } = own;
  const t = threshold;
  if (stats.count === 0) {
    return `<h2>${esc(entry.name)}の下落実績(過去2年)</h2>
<p style="font-size:13px;">過去2年間、前日比${t}%以上の下落は<strong>一度もありません</strong>でした。値動きが比較的おだやかな銘柄です。</p>`;
  }
  const lat = stats.latest;
  const latText = lat
    ? `直近では<strong>${lat.date}</strong>に<strong>${lat.chg}%</strong>の下落がありました。`
    : "";
  const usable = OWN_HORIZONS.filter((h) => stats.horizons[h]);
  if (!usable.length) {
    return `<h2>${esc(entry.name)}の下落実績(過去2年)</h2>
<p style="font-size:13px;">過去2年間で前日比${t}%以上下落した日は<strong>${stats.count}回</strong>でした。${latText}</p>
<p style="font-size:12px;opacity:0.6;">サンプル数が${OWN_MIN_SAMPLES}件未満のため、この銘柄単独のリバウンド勝率は掲載していません。下の分類別統計を参考にしてください。</p>`;
  }
  const rows = usable
    .map((h) => {
      const x = stats.horizons[h];
      const cls = x.avg > 0 ? "pct-up" : x.avg < 0 ? "pct-down" : "";
      return `  <tr><th style="width:auto;">${h}営業日後<br/><small>n=${x.n}</small></th><td>${x.win}%</td><td class="${cls}">${x.avg > 0 ? "+" : ""}${x.avg}%</td><td>${x.med > 0 ? "+" : ""}${x.med}%</td></tr>`;
    })
    .join("\n");
  return `<h2>${esc(entry.name)}の下落実績(過去2年)</h2>
<p style="font-size:13px;">過去2年間で前日比${t}%以上下落した日は<strong>${stats.count}回</strong>ありました。${latText}その下落日を起点に、その後この銘柄自身がどう動いたかを集計しています。</p>
<table>
  <tr><th style="width:auto;">経過</th><th>勝率</th><th>平均</th><th>中央値</th></tr>
${rows}
</table>
<p style="font-size:12px;opacity:0.6;">株式分割の影響を除いた調整後価格で計算しています。過去2年という短期間の集計であり、将来の値動きを保証するものではありません。</p>`;
}

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
    "code,last_price,last_change_pct,last_updated_at,last_volume,last_turnover,annual_dividend,dividend_yield,last_dividend_date,last_dividend_amount"
  );
  const { data: statsRows } = await supabase.from("trade_stats").select("*").limit(1);
  const trades = await fetchAll(
    "trade_record",
    "code,name,position_type,alert_level,entry_date,entry_price,quantity,exit_date,exit_price,pnl,return_pct,holding_days,is_closed,memo"
  );
  const stats = (statsRows && statsRows[0]) || {};

  console.log("銘柄固有の下落ヒストリを取得中...");
  const ownStats = await fetchAllOwnStats(catalog);

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

    const title = `${e.name}（${e.code}）分配金・利回り・信託報酬・下落統計｜ETF下落統計データベース`;
    const description = `${e.name}(${e.code})の分配金${
      s.annual_dividend != null ? `年${s.annual_dividend}円(利回り${s.dividend_yield ?? "—"}%)` : "情報"
    }・信託報酬${e.expense_ratio}%・純資産${aumText(e.aum)}・前日比${pct(
      s.last_change_pct,
      1
    )}。下落局面での過去統計とあわせて無料で公開。`;

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

${dividendSection(e, s)}

${ownHistorySection(e, ownStats[e.code])}

${reboundStatsSection(e)}

${relatedSection(e, catalog, stateByCode)}

<a class="cta" href="${SITE_URL}/?code=${esc(e.code)}">アプリでこの銘柄を監視・通知登録する</a>

${affiliateBlockHtml()}

<p class="back"><a href="${SITE_URL}/etf/">← 全ETF一覧</a>　<a href="${SITE_URL}/report/etf-drop-threshold/">何%下落したら買うべきか（検証記事）</a>　<a href="${SITE_URL}/haito/">分配金利回りランキング</a>　<a href="${SITE_URL}/jisseki/">実際の売買記録</a></p>
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
  // 本日の下落率ランキング(毎日変わるため、このページ自身の更新性を示す内容になる)
  const todayDrops = [...catalog]
    .map((e) => ({ e, chg: (stateByCode[e.code] || {}).last_change_pct }))
    .filter((x) => typeof x.chg === "number" && x.chg < 0)
    .sort((a, b) => a.chg - b.chg)
    .slice(0, 20);
  const dropSection = todayDrops.length
    ? `<h2>本日の下落率ランキング（上位${todayDrops.length}銘柄）</h2>
<p style="font-size:13px;opacity:0.8;">前営業日の終値と比べて下落率が大きい順です。毎営業日の取引終了後に自動更新しています。</p>
<table>
  <tr><th>順位</th><th>銘柄</th><th>前日比</th></tr>
${todayDrops
  .map(
    (x, i) =>
      `  <tr><td>${i + 1}</td><td><a href="${SITE_URL}/etf/${esc(x.e.code)}/">${esc(x.e.name)}</a><br/><span class="code">${esc(x.e.code)}</span></td><td class="pct-down">${pct(x.chg, 2)}</td></tr>`
  )
  .join("\n")}
</table>`
    : "";

  // ジャンル別に見出しを付けて並べる(見出しがないと437件の羅列になり、
  // 検索エンジンからも読者からも構造が読み取れないため)
  const CATEGORY_ORDER = ["国内株式", "外国株式", "債券", "REIT", "コモディティ", "その他"];
  const byCategory = {};
  for (const e of sorted) {
    const c = CATEGORY_ORDER.includes(e.category) ? e.category : "その他";
    (byCategory[c] = byCategory[c] || []).push(e);
  }
  const categorySections = CATEGORY_ORDER.filter((c) => byCategory[c]?.length)
    .map((c) => {
      const items = byCategory[c]
        .map((e) => {
          const st = stateByCode[e.code] || {};
          return `<a class="list-row" href="${SITE_URL}/etf/${esc(e.code)}/"><span class="n">${esc(e.name)}</span><span class="c">${esc(e.code)} / ${pct(st.last_change_pct, 1)}</span></a>`;
        })
        .join("\n");
      return `<h2>${esc(c)}（${byCategory[c].length}銘柄）</h2>\n${items}`;
    })
    .join("\n");

  const listBody = `
<h1>日本ETF 下落統計データベース（全${catalog.length}銘柄）</h1>
<p style="font-size:14px;">日本の証券取引所に上場しているETF全${catalog.length}銘柄について、信託報酬・純資産・分配金・前日比を毎営業日に自動更新して掲載しています。各銘柄のページでは、その銘柄が過去2年間に前日比で大きく下落した回数と、下落した後に実際どう動いたかの集計も確認できます。</p>
<p style="font-size:14px;">下落局面での買い付けを検討する際の判断材料として、ジャンル別に一覧できるようにまとめました。銘柄名をタップすると個別ページに移動します。</p>
<a class="cta" href="${SITE_URL}/report/etf-drop-threshold/">ETFは何%下落したら買うべきか（10年分の検証結果）</a>
<a class="cta" href="${SITE_URL}/haito/">分配金利回りランキングを見る</a>
<a class="cta" href="${SITE_URL}/jisseki/">実際の売買記録・成績を見る</a>
${dropSection}
<h2>ジャンル別 全銘柄一覧</h2>
${categorySections}
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

  // ---------- 高配当ランキングページ ----------
  // 「高配当ETF ランキング」「(コード) 分配金」は検索需要が大きく、
  // 実際に分配金関連のクエリからの流入が確認されているため専用ページを設ける。
  console.log("高配当ランキングページ生成中...");
  const RANK_LIMIT = 50;
  const ranked = catalog
    .map((e) => ({ e, s: stateByCode[e.code] || {} }))
    .filter((x) => x.s.dividend_yield != null && x.s.dividend_yield > 0)
    .sort((a, b) => b.s.dividend_yield - a.s.dividend_yield)
    .slice(0, RANK_LIMIT);

  const rankRows = ranked
    .map(
      ({ e, s }, i) => `<tr>
      <td>${i + 1}</td>
      <td><a href="${SITE_URL}/etf/${e.code}/">${esc(e.name)}</a><br/><span class="code">${e.code}</span></td>
      <td style="white-space:nowrap;"><strong>${s.dividend_yield}%</strong></td>
      <td style="white-space:nowrap;">${s.annual_dividend}円</td>
      <td style="white-space:nowrap;">${e.expense_ratio}%</td>
    </tr>`
    )
    .join("\n");

  const rankBody = `
<h1>日本ETF 分配金利回りランキング TOP${ranked.length}</h1>
<p style="font-size:14px;">東証上場ETFを、直近1年間の分配金実績にもとづく利回り順に並べています。毎日自動更新。利回りは「直近1年の分配金合計 ÷ 現在価格」で算出した参考値です。</p>
<div style="overflow-x:auto;">
<table>
  <tr><th style="width:auto;">順位</th><th style="width:auto;">銘柄</th><th style="width:auto;">利回り</th><th style="width:auto;">年間分配金</th><th style="width:auto;">信託報酬</th></tr>
  ${rankRows}
</table>
</div>
<p style="font-size:12px;opacity:0.6;">利回りが高い銘柄には、カバードコール型など特有の仕組みを持つものや、価格下落によって見かけ上の利回りが上昇しているものが含まれます。利回りの高さだけで優劣は判断できません。税金は考慮していません。本ページは投資助言ではありません。</p>

<a class="cta" href="${SITE_URL}/etf/">全${catalog.length}銘柄の一覧を見る</a>
`;
  mkdirSync(`${OUT_ROOT}/haito`, { recursive: true });
  writeFileSync(
    `${OUT_ROOT}/haito/index.html`,
    pageLayout({
      title: `日本ETF分配金利回りランキング TOP${ranked.length}（毎日自動更新）`,
      description: `東証上場ETFを分配金利回り順に掲載。年間分配金・信託報酬もあわせて比較できます。毎日自動更新。`,
      canonical: `${SITE_URL}/haito/`,
      bodyHtml: rankBody,
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

  // ---------- 記事: ETFは何%下落したら買うべきか ----------
  console.log("記事ページ生成中...");
  const articleDate = new Date().toISOString().slice(0, 10);

  // 記事内の「本日該当している銘柄」は毎営業日変わる。
  // これにより記事が読み切りにならず、再訪の理由と更新シグナルの両方が生まれる。
  const articleTargets = catalog
    .map((e) => {
      const levels = categoryDefaultLevels(e);
      if (!levels) return null;
      const st = stateByCode[e.code] || {};
      const chg = st.last_change_pct;
      if (typeof chg !== "number") return null;
      const hit = levels.filter((l) => chg <= l).sort((a, b) => a - b)[0];
      if (hit == null) return null;
      return { e, chg, hit, group: levels === THEME_DEFAULT_LEVELS ? "テーマ系" : "広域インデックス系" };
    })
    .filter(Boolean)
    .sort((a, b) => a.chg - b.chg)
    .slice(0, 30);

  const todayBlock = articleTargets.length
    ? `<table>
  <tr><th>銘柄</th><th>分類</th><th>前日比</th><th>到達</th></tr>
${articleTargets
  .map(
    (t) =>
      `  <tr><td><a href="${SITE_URL}/etf/${esc(t.e.code)}/">${esc(
        t.e.name
      )}</a><br/><span class="code">${esc(t.e.code)}</span></td><td>${t.group}</td><td class="pct-down">${pct(
        t.chg,
        2
      )}</td><td>${t.hit}%</td></tr>`
  )
  .join("\n")}
</table>`
    : `<p style="font-size:14px;">本日、閾値に到達している銘柄はありません。下で説明するとおり、深い下落は年に数回しか起きません。待つことがこの手法の本体です。</p>`;

  const articleBody = `
<h1>ETFは何％下落したら買うべきか — 10年分の実データで検証した</h1>
<p style="font-size:13px;opacity:0.7;">最終更新: ${articleDate}（このページの「本日の該当銘柄」は毎営業日に自動更新されます）</p>

<p style="font-size:14px;">「安く買って高く売る」とはよく言われますが、では具体的に何％下がったら買えばいいのか。この問いに数字で答えるため、日本の主要ETF53銘柄について過去10年分の日次データを集計しました。</p>

<h2>結論</h2>
<p style="font-size:14px;">TOPIXや日経225のような広範な指数に連動するETFが<strong>1日で8％以上下落した後に買い、約3ヶ月保有した場合、過去10年で27回すべてがプラス</strong>で終わっていました。平均リターンは+24.1％です。</p>
<p style="font-size:14px;">ただしこの数字だけを見るのは危険です。理由は後述します。</p>

<h2>本日、閾値に到達している銘柄</h2>
${todayBlock}

<h2>検証の条件</h2>
<table>
  <tr><th>対象</th><td>日本上場ETFのうち純資産1,000億円以上・レバレッジ／インバース型を除く53銘柄</td></tr>
  <tr><th>期間</th><td>過去10年（日次終値、株式分割は調整済み）</td></tr>
  <tr><th>買うタイミング</th><td>前日比で閾値以上に下落した日の終値</td></tr>
  <tr><th>保有期間</th><td>63営業日（約3ヶ月）</td></tr>
  <tr><th>除外</th><td>1日で±30％を超える異常値（分割等の可能性）</td></tr>
</table>
<p style="font-size:14px;">ETFは値動きの性質で2つに分けています。TOPIX・日経225・S&amp;P500など広範な指数に連動するものを「広域インデックス系」、半導体・高配当・REITなど特定分野に絞ったものを「テーマ系」としました。両者は下落の頻度も深さも大きく違うため、同じ閾値で語ることができません。</p>

<h2>閾値別の結果</h2>
<h3>広域インデックス系</h3>
<table>
  <tr><th>下落率</th><th>回数</th><th>勝率</th><th>平均リターン</th></tr>
  <tr><td>-3%</td><td>695回</td><td>83.7%</td><td class="pct-up">+11.0%</td></tr>
  <tr><td>-5%</td><td>149回</td><td>96.6%</td><td class="pct-up">+18.0%</td></tr>
  <tr><td>-8%</td><td>27回</td><td>100%</td><td class="pct-up">+24.1%</td></tr>
</table>
<h3>テーマ系</h3>
<table>
  <tr><th>下落率</th><th>回数</th><th>勝率</th><th>平均リターン</th></tr>
  <tr><td>-3%</td><td>1,192回</td><td>69.0%</td><td class="pct-up">+5.9%</td></tr>
  <tr><td>-7%</td><td>177回</td><td>68.9%</td><td class="pct-up">+9.9%</td></tr>
  <tr><td>-10%</td><td>81回</td><td>70.4%</td><td class="pct-up">+10.6%</td></tr>
</table>
<p style="font-size:14px;">深く下げたときほど成績が良くなります。そしてテーマ系は、より深い下落を待たないと同じ質のリバウンドが得られません。</p>

<h2>「いつ買っても勝てたのでは？」への回答</h2>
<p style="font-size:14px;">ここが最も重要な点です。過去10年の日本株は上昇基調だったため、下落を待たず適当な日に買っても、3ヶ月後にはプラスになっていた可能性があります。それなら「下がったら買う」に意味はありません。</p>
<p style="font-size:14px;">そこで、同じ期間・同じ銘柄で「毎日買った場合」を計算し、比較しました。</p>
<table>
  <tr><th>買い方</th><th>勝率</th><th>平均リターン</th></tr>
  <tr><td>広域インデックス系を無条件に買う</td><td>69.7%</td><td>+4.2%</td></tr>
  <tr><td>広域インデックス系を-8%下落時に買う</td><td>100%</td><td class="pct-up">+24.1%</td></tr>
  <tr><td>テーマ系を無条件に買う</td><td>61.3%</td><td>+2.5%</td></tr>
  <tr><td>テーマ系を-10%下落時に買う</td><td>70.4%</td><td class="pct-up">+10.6%</td></tr>
</table>
<p style="font-size:14px;">無条件でも勝率は約7割ありました。つまり<strong>「勝率83％」という数字の一部は、単に相場が上昇していたことの反映</strong>です。それでも下落時に買うほうが勝率で14〜30ポイント、平均リターンで7〜20ポイント上回りました。上昇相場を差し引いても、下落時に買う優位性は残っています。</p>

<h2>保有期間を間違えると効果が出ない</h2>
<p style="font-size:14px;">同じデータを20営業日（約1ヶ月）保有で計算し直すと、優位性はほとんど消えます。下落直後の数日から数週間は値動きが荒く、方向が定まりません。</p>
<p style="font-size:14px;">この手法は、買ってから2〜3ヶ月待てる資金でないと機能しないということです。すぐに戻ることを期待して短期で手仕舞うと、最も成績の良い部分を取り逃します。</p>

<h2>この手法の最大の難点</h2>
<p style="font-size:14px;">-8％の下落は<strong>10年間で27回</strong>しかありません。53銘柄を合わせての回数なので、1銘柄あたりでは数年に一度です。</p>
<p style="font-size:14px;">つまりこの手法の本体は、分析ではなく<strong>待つこと</strong>です。そして問題は、数年に一度の機会を捉えるために毎日相場を見続けるのは現実的でない、という点にあります。下落は予告なく起きます。</p>
<p style="font-size:14px;">当サイトは、この問題を解決するために作りました。日本ETF全437銘柄を自動で監視し、閾値に到達した銘柄をプッシュ通知でお知らせします。無料で、登録も不要です。</p>
<a class="cta" href="${SITE_URL}/">下落通知を受け取る（無料・登録不要）</a>

<h2>注意点</h2>
<ul style="font-size:14px;line-height:1.9;">
  <li><strong>サンプル数が少ない</strong> — -8％の27回という数字は、統計的には十分とは言えません。勝率100％は「たまたま負けがなかった」可能性を含みます。</li>
  <li><strong>検証期間が上昇相場に偏っている</strong> — 過去10年に長期の下落局面は含まれていません。リーマンショックのような局面では結果が変わります。</li>
  <li><strong>分配金を含んでいません</strong> — 実際のリターンはこれより高くなります。</li>
  <li><strong>信用取引を使う場合はリスクが変わります</strong> — 3ヶ月の保有中に含み損を抱える期間があり、レバレッジをかけていれば追証の可能性があります。</li>
</ul>

<h2>関連ページ</h2>
<p style="font-size:14px;">当サイトでは各ETFの個別ページで、その銘柄自身が過去2年間に何回下落し、その後どう動いたかを掲載しています。</p>
<a class="cta" href="${SITE_URL}/etf/">全437銘柄の下落統計を見る</a>
<a class="cta" href="${SITE_URL}/jisseki/">運営者の実際の売買記録を見る</a>

${affiliateBlockHtml()}

<div class="note">
  本記事は投資助言ではありません。過去のデータの集計結果であり、将来の成果を保証するものではありません。<br/>
  投資判断はご自身の責任で行ってください。信用取引には元本超過損のリスクがあります。
</div>
`;
  mkdirSync(`${OUT_ROOT}/report/etf-drop-threshold`, { recursive: true });
  writeFileSync(
    `${OUT_ROOT}/report/etf-drop-threshold/index.html`,
    pageLayout({
      title: "ETFは何％下落したら買うべきか｜10年分の実データで検証",
      description:
        "日本の主要ETF53銘柄・過去10年の日次データで「下落時に買う」を検証。広域インデックス系は-8%下落後3ヶ月で勝率100%・平均+24.1%。無条件に買った場合との比較も掲載。",
      canonical: `${SITE_URL}/report/etf-drop-threshold/`,
      ogType: "article",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Article",
        headline: "ETFは何％下落したら買うべきか — 10年分の実データで検証した",
        description: "日本の主要ETF53銘柄・過去10年の日次データで「下落時に買う」を検証した結果。",
        datePublished: "2026-08-31",
        dateModified: articleDate,
        author: { "@type": "Person", name: "しのぎん" },
        publisher: { "@type": "Organization", name: "ETF下落統計データベース" },
        mainEntityOfPage: `${SITE_URL}/report/etf-drop-threshold/`,
        inLanguage: "ja",
      },
      bodyHtml: articleBody,
    })
  );

  // ---------- sitemap.xml ----------
  console.log("sitemap.xml生成中...");
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${SITE_URL}/`, priority: "1.0", changefreq: "daily" },
    { loc: `${SITE_URL}/etf/`, priority: "0.9", changefreq: "daily" },
    { loc: `${SITE_URL}/haito/`, priority: "0.9", changefreq: "weekly" },
    { loc: `${SITE_URL}/jisseki/`, priority: "0.7", changefreq: "weekly" },
    { loc: `${SITE_URL}/report/etf-drop-threshold/`, priority: "0.9", changefreq: "daily" },
    ...sorted.map((e) => ({ loc: `${SITE_URL}/etf/${e.code}/`, priority: "0.6", changefreq: "daily" })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`).join("\n")}
</urlset>`;
  writeFileSync(`${OUT_ROOT}/sitemap.xml`, sitemap);

  console.log(`完了: ETFページ${catalog.length}件 + 一覧 + 実績ページ + sitemap.xml`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
