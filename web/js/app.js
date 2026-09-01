const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---------- タブ切り替え ----------
document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll("section").forEach((s) => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "home") loadHome();
    if (btn.dataset.tab === "history") loadHistory();
  });
});

// 戻るボタン
document.getElementById("detail-back").addEventListener("click", () => {
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll("section").forEach((s) => s.classList.remove("active"));
  document.querySelector('nav button[data-tab="catalog"]').classList.add("active");
  document.getElementById("catalog").classList.add("active");
  applyCatalogView();
});

function pctClass(pct) {
  if (pct == null) return "";
  return pct < 0 ? "pct-down" : "pct-up";
}
function fmtPct(pct) {
  if (pct == null) return "—";
  return (pct > 0 ? "+" : "") + pct.toFixed(1) + "%";
}

// カテゴリ別デフォルト通知レベル(cron/check-prices.mjsと同じ基準)。
// 表示上「空欄なら何が適用されるか」をユーザーに見せるためだけに使う(実際の判定はcron側)。
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
  if (!entry || entry.is_leveraged || entry.is_inverse) return null;
  const idx = entry.index_name || "";
  const isBroadIndex = BROAD_INDEX_KEYWORDS.some((kw) => idx.includes(kw));
  return isBroadIndex ? INDEX_DEFAULT_LEVELS : THEME_DEFAULT_LEVELS;
}

// 過去10年バックテスト(流動性フィルター後、分割等の異常値除外)による
// カテゴリ×通知レベル×経過営業日ごとの勝率(win,%)・平均リターン(avg,%)・中央値リターン(med,%)・サンプル数(n)。
// cron/check-prices.mjsのREBOUND_MATRIXと同一データ(出典: 2026-07実施のバックテスト)。
const REBOUND_MATRIX = {"index":{"-3":{"10":{"n":1472,"win":65.5,"avg":1.5,"med":2.3},"15":{"n":1467,"win":65.6,"avg":2.1,"med":2.7},"20":{"n":1454,"win":70.1,"avg":3.7,"med":3.3},"30":{"n":1436,"win":74.0,"avg":4.9,"med":5.3},"63":{"n":1411,"win":79.9,"avg":9.5,"med":9.5}},"-5":{"10":{"n":326,"win":70.6,"avg":3.5,"med":4.8},"15":{"n":325,"win":69.8,"avg":5.0,"med":6.0},"20":{"n":324,"win":77.2,"avg":6.9,"med":7.9},"30":{"n":321,"win":76.3,"avg":7.4,"med":8.2},"63":{"n":319,"win":88.7,"avg":14.5,"med":16.1}},"-8":{"10":{"n":72,"win":81.9,"avg":7.3,"med":7.7},"15":{"n":72,"win":81.9,"avg":10.0,"med":11.9},"20":{"n":72,"win":84.7,"avg":12.0,"med":15.4},"30":{"n":72,"win":86.1,"avg":11.1,"med":14.3},"63":{"n":72,"win":87.5,"avg":18.5,"med":24.2}}},"theme":{"-3":{"10":{"n":4939,"win":59.9,"avg":1.1,"med":1.6},"15":{"n":4907,"win":59.7,"avg":1.5,"med":1.7},"20":{"n":4882,"win":60.6,"avg":2.3,"med":2.3},"30":{"n":4825,"win":61.1,"avg":2.6,"med":2.7},"63":{"n":4657,"win":66.3,"avg":6.8,"med":5.4}},"-7":{"10":{"n":600,"win":63.0,"avg":2.2,"med":3.8},"15":{"n":593,"win":65.4,"avg":3.6,"med":5.7},"20":{"n":590,"win":65.9,"avg":4.5,"med":5.9},"30":{"n":583,"win":64.8,"avg":3.5,"med":6.3},"63":{"n":575,"win":65.2,"avg":8.2,"med":8.3}},"-10":{"10":{"n":242,"win":69.0,"avg":4.3,"med":6.9},"15":{"n":241,"win":68.5,"avg":5.8,"med":11.4},"20":{"n":241,"win":68.9,"avg":6.9,"med":11.3},"30":{"n":240,"win":68.3,"avg":5.4,"med":10.4},"63":{"n":240,"win":68.3,"avg":10.9,"med":11.2}}}};
const REBOUND_HORIZON_LABELS = { "10": "10営業日", "15": "15営業日", "20": "20営業日", "30": "30営業日", "63": "63営業日(約3ヶ月)" };

// 複数日「じわじわ型」下落の閾値(cron/check-prices.mjsと同一)。
// 同じ下落幅でも単日急落型のほうが短期リバウンドの質が高く、数営業日かけた下落は
// 同等のリバウンドを得るのにより深い累積が必要、というバックテスト結果に基づく。
const CUM_WINDOW_DAYS = 3;
const CUM_INDEX_LEVEL = -14;
const CUM_THEME_LEVEL = -16;

function cumulativeThreshold(entry) {
  const levels = categoryDefaultLevels(entry);
  if (!levels) return null; // レバレッジ/インバースは対象外
  return levels === THEME_DEFAULT_LEVELS ? CUM_THEME_LEVEL : CUM_INDEX_LEVEL;
}

// 直近N営業日の累積下落率を計算(dailyPricesは日付降順)
function cumulativeChangePct(dailyPrices, windowDays) {
  if (!dailyPrices || dailyPrices.length < windowDays + 1) return null;
  const latest = dailyPrices[0].close;
  const base = dailyPrices[windowDays].close;
  if (!base || base <= 0) return null;
  return ((latest - base) / base) * 100;
}

function renderReboundStatsTable(entry) {
  const levels = categoryDefaultLevels(entry);
  if (!levels) return ""; // レバレッジ/インバースはバックテスト対象外
  const group = levels === THEME_DEFAULT_LEVELS ? "theme" : "index";
  const groupLabel = group === "theme" ? "テーマ系" : "指数系";
  const rows = levels
    .slice()
    .sort((a, b) => a - b)
    .map((level) => {
      const byHorizon = REBOUND_MATRIX[group]?.[String(level)];
      if (!byHorizon) return "";
      const cells = Object.keys(REBOUND_HORIZON_LABELS)
        .map((d) => {
          const st = byHorizon[d];
          if (!st) return `<td style="padding:3px 6px;">—</td>`;
          return `<td style="padding:3px 6px; white-space:nowrap;">勝率${st.win}%<br>平均${st.avg}%/中央値${st.med}%</td>`;
        })
        .join("");
      return `<tr><td style="padding:3px 6px; font-weight:bold;">${level}%</td>${cells}</tr>`;
    })
    .join("");
  const headerCells = Object.values(REBOUND_HORIZON_LABELS)
    .map((label) => `<th style="padding:3px 6px; font-weight:normal; opacity:0.7;">${label}</th>`)
    .join("");
  return `
    <div class="detail-section">
      <h3>参考: 過去10年バックテスト(${groupLabel})</h3>
      <div style="font-size:11px; opacity:0.7; margin-bottom:6px;">流動性フィルター後・分割等の異常値除外。到達日終値を基準にN営業日後の変化率を集計。投資助言ではありません。</div>
      <div style="font-size:11px; opacity:0.7; margin-bottom:6px;">上表は<strong>単日急落型</strong>の成績です。数営業日かけてじわじわ下げた場合はリバウンドが弱く、同等の質を得るには${CUM_WINDOW_DAYS}営業日累計で<strong>${cumulativeThreshold(entry)}%</strong>程度の深さが必要という結果でした(この深さに達すると通知します)。</div>
      <div style="overflow-x:auto;">
        <table style="font-size:11px; border-collapse:collapse; min-width:100%;">
          <thead><tr><th style="padding:3px 6px;"></th>${headerCells}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

// ---------- カタログ ----------
// 流動性スクリーニング(AUM下限・売買代金下限)はUI上のスライダー(filter-aum-min /
// filter-turnover-min)で可変。詳細はapplyCatalogView()を参照。

let catalogCache = [];
let userStatesCache = [];
let userStatesByCode = {};

async function loadCatalog() {
  const { data, error } = await sb.from("etf_catalog").select("*").order("code");
  if (error) {
    console.error(error);
    return;
  }
  catalogCache = data || [];
  populateThemeFilter();
  await refreshUserStatesCache();
  applyCatalogView();
}

const THEME_GROUPS = {
  "ジャンル(詳細)": ["日本株（市場別）", "日本株（業種別）", "日本株（規模別）", "日本株（テーマ別）", "外国株", "国内債券", "外国債券", "不動産（REIT）", "商品・商品指数", "商品(外国投資法人債券)", "エンハンスト型", "レバレッジ型・インバース型"],
  "セクター・業種": ["半導体", "金融", "自動車", "通信", "ゲーム", "食品", "小売", "バイオ", "インフラ", "物流", "銀行"],
  "投資スタイル": ["高配当", "ESG", "グロース株", "バリュー株", "中小型株"],
  "地域": ["米国", "中国", "インド", "新興国"],
  "コモディティ": ["原油", "プラチナ", "シルバー", "天然ガス", "農産物"],
  "先端テクノロジー": ["AI", "ロボティクス", "電気自動車(EV)", "デジタル"],
};

function populateThemeFilter() {
  const excluded = new Set(["レバレッジ", "インバース"]);
  const present = new Set();
  catalogCache.forEach((en) => {
    (en.themes || []).forEach((t) => {
      if (t && !excluded.has(t)) present.add(t);
    });
  });

  const select = document.getElementById("filter-theme");
  let html = '<option value="">すべてのテーマ</option>';
  const usedThemes = new Set();

  Object.entries(THEME_GROUPS).forEach(([groupLabel, themeList]) => {
    const itemsInGroup = themeList.filter((t) => present.has(t));
    if (itemsInGroup.length === 0) return;
    html += `<optgroup label="${groupLabel}">`;
    itemsInGroup.forEach((t) => {
      html += `<option value="${t}">${t}</option>`;
      usedThemes.add(t);
    });
    html += `</optgroup>`;
  });

  const others = Array.from(present)
    .filter((t) => !usedThemes.has(t))
    .sort((a, b) => a.localeCompare(b, "ja"));
  if (others.length > 0) {
    html += `<optgroup label="その他">`;
    others.forEach((t) => {
      html += `<option value="${t}">${t}</option>`;
    });
    html += `</optgroup>`;
  }

  select.innerHTML = html;
}

async function refreshUserStatesCache() {
  userStatesCache = await loadUserStates();
  userStatesByCode = Object.fromEntries(userStatesCache.map((s) => [s.code, s]));
}

async function loadUserStates() {
  const { data } = await sb.from("etf_user_state").select("*");
  return data || [];
}

// 日本時間の「今日」をYYYY-MM-DD形式で返す。
// toISOString()はUTC基準のため、00:00-09:00 JSTの間は前日の日付になってしまう。
// Supabaseに保存している date 列は日本の営業日なので、必ずJSTで揃える。
function jstDateString(base = new Date()) {
  return new Date(base.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function fmtAum(aum) {
  if (!aum) return "—";
  const oku = aum / 100000000;
  if (oku >= 10000) return (oku / 10000).toFixed(1) + "兆円";
  return Math.round(oku).toLocaleString() + "億円";
}

function tagChips(entry) {
  const tags = [];
  if (entry.category) tags.push(entry.category);
  if (entry.is_leveraged) tags.push("レバレッジ");
  if (entry.is_inverse) tags.push("インバース");
  (entry.themes || []).forEach((t) => {
    if (!tags.includes(t)) tags.push(t);
  });
  return tags
    .slice(0, 4)
    .map((t) => `<span class="chip">${t}</span>`)
    .join("");
}

function chgBadge(entry) {
  const state = userStatesByCode[entry.code];
  if (!state || state.last_change_pct == null) {
    return `<div class="chg-badge" style="opacity:0.4;">前日比 —</div>`;
  }
  return `<div class="chg-badge ${pctClass(state.last_change_pct)}">前日比 ${fmtPct(state.last_change_pct)}</div>`;
}

function renderCatalog(list) {
  const container = document.getElementById("catalog-list");
  container.innerHTML = "";
  list.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "row catalog-row";
    row.innerHTML = `
      <div class="catalog-main">
        <div class="name">${entry.name}</div>
        <div class="code">${entry.code} / ${entry.issuer}</div>
        <div class="chips">${tagChips(entry)}</div>
        <div class="meta">
          信託報酬 ${entry.expense_ratio != null ? entry.expense_ratio.toFixed(3) + "%" : "—"}
          ／ 純資産 ${fmtAum(entry.aum)}
        </div>
        ${chgBadge(entry)}
      </div>
      <div class="catalog-actions">
        <button class="toggle" data-action="watch" data-code="${entry.code}">監視</button>
        <button class="toggle" data-action="favorite" data-code="${entry.code}">★</button>
      </div>`;
    container.appendChild(row);
  });
  refreshToggleStates();
}

function refreshToggleStates() {
  document.querySelectorAll("#catalog-list .toggle").forEach((btn) => {
    const code = btn.dataset.code;
    const s = userStatesByCode[code];
    const isOn = btn.dataset.action === "watch" ? s?.is_watched : s?.is_favorite;
    btn.classList.toggle("on", !!isOn);
  });
}

document.getElementById("catalog-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button.toggle");
  if (!btn) return;
  const code = btn.dataset.code;
  const action = btn.dataset.action;
  let state = userStatesByCode[code];
  const current = state ? (action === "watch" ? state.is_watched : state.is_favorite) : false;

  if (!state) {
    await sb.from("etf_user_state").insert({
      code,
      is_watched: action === "watch" ? !current : false,
      is_favorite: action === "favorite" ? !current : false,
    });
  } else {
    const field = action === "watch" ? "is_watched" : "is_favorite";
    await sb.from("etf_user_state").update({ [field]: !current }).eq("code", code);
  }
  await refreshUserStatesCache();
  applyCatalogView();
});

// カタログ行をクリックして詳細画面へ
document.getElementById("catalog-list").addEventListener("click", async (e) => {
  const row = e.target.closest(".catalog-row");
  if (!row || e.target.closest("button.toggle")) return; // トグルボタンクリックは無視
  const code = row.querySelector("button.toggle")?.dataset?.code;
  if (code) {
    await showDetail(code);
  }
});

function applyCatalogView() {
  const q = document.getElementById("search-box").value.trim().toLowerCase();
  const category = document.getElementById("filter-category").value;
  const theme = document.getElementById("filter-theme").value;
  const expenseSlider = parseInt(document.getElementById("filter-expense-max").value, 10);
  const expenseMax = expenseSlider >= 250 ? null : expenseSlider / 100;
  document.getElementById("expense-max-label").textContent =
    expenseMax == null ? "上限なし" : expenseMax.toFixed(2) + "%以下";
  const onlyLev = document.getElementById("filter-leveraged").checked;
  const onlyInv = document.getElementById("filter-inverse").checked;
  const aumMinOku = parseInt(document.getElementById("filter-aum-min").value, 10);
  const aumMin = aumMinOku * 100_000_000; // 億円 -> 円
  document.getElementById("aum-min-label").textContent = aumMinOku === 0 ? "指定なし" : `${aumMinOku}億円`;
  document.getElementById("filter-aum-min-num").value = aumMinOku;
  const turnoverMinMan = parseInt(document.getElementById("filter-turnover-min").value, 10);
  const turnoverMin = turnoverMinMan * 10_000; // 万円 -> 円
  document.getElementById("turnover-min-label").textContent =
    turnoverMinMan === 0 ? "指定なし" : `${turnoverMinMan.toLocaleString()}万円`;
  document.getElementById("filter-turnover-min-num").value = turnoverMinMan;
  const sortKey = document.getElementById("sort-select").value;

  let list = catalogCache.filter((en) => {
    if (q) {
      const hit =
        en.name.toLowerCase().includes(q) ||
        en.code.toLowerCase().includes(q) ||
        (en.nickname || "").toLowerCase().includes(q) ||
        en.issuer.toLowerCase().includes(q) ||
        en.index_name.toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (category && en.category !== category) return false;
    if (theme && !(en.themes || []).includes(theme)) return false;
    if (expenseMax != null) {
      if (en.expense_ratio == null || en.expense_ratio > expenseMax) return false;
    }
    if (onlyLev && !en.is_leveraged) return false;
    if (onlyInv && !en.is_inverse) return false;
    if (aumMin > 0 && (en.aum ?? 0) < aumMin) return false;
    if (turnoverMin > 0) {
      const turnover = userStatesByCode[en.code]?.last_turnover;
      // 売買代金データが未取得の銘柄はAUM側の基準のみで判定(過剰除外を避ける)
      if (turnover != null && turnover < turnoverMin) return false;
    }
    return true;
  });

  list = list.slice().sort((a, b) => {
    if (sortKey === "code") return a.code.localeCompare(b.code);
    if (sortKey === "expense_asc") return (a.expense_ratio ?? Infinity) - (b.expense_ratio ?? Infinity);
    if (sortKey === "aum_desc") return (b.aum ?? 0) - (a.aum ?? 0);
    if (sortKey === "change_asc") {
      const ca = userStatesByCode[a.code]?.last_change_pct;
      const cb = userStatesByCode[b.code]?.last_change_pct;
      if (ca == null && cb == null) return 0;
      if (ca == null) return 1;
      if (cb == null) return -1;
      return ca - cb;
    }
    return a.name.localeCompare(b.name, "ja");
  });

  renderCatalog(list);
}

// ---------- 詳細画面 ----------
let currentDetailCode = null;

async function showDetail(code) {
  currentDetailCode = code;
  const entry = catalogCache.find((c) => c.code === code);
  const state = userStatesByCode[code] || {};

  // ローディング表示
  document.getElementById("detail-content").innerHTML = 
    '<div style="text-align:center; padding:40px; opacity:0.7;">' +
    '<div style="font-size:12px;">読み込み中...</div>' +
    '</div>';

  // 詳細タブに切り替え
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll("section").forEach((s) => s.classList.remove("active"));
  document.querySelector('nav button[data-tab="detail"]')?.classList.add("active");
  document.getElementById("detail").classList.add("active");

  // 詳細内容の生成
  let html = `
    <div class="detail-header">
      <div class="name">${entry.name}</div>
      <div class="code">${entry.code} / ${entry.issuer}</div>
      <div style="margin-top:8px; display:flex; gap:4px;">
        <span style="font-size:12px; opacity:0.7;">連動指数: ${entry.index_name}</span>
      </div>
    </div>
    <div class="detail-section">
      <h3>基本情報</h3>
      <div style="font-size:13px; line-height:1.6;">
        <div>信託報酬: ${entry.expense_ratio != null ? entry.expense_ratio.toFixed(3) + "%" : "—"}</div>
        <div>純資産: ${fmtAum(entry.aum)}</div>
        <div>ジャンル: ${entry.category || "—"}</div>
        ${entry.is_leveraged ? '<div>🔴 レバレッジ型</div>' : ''}
        ${entry.is_inverse ? '<div>🔴 インバース型</div>' : ''}
      </div>
    </div>

    <div class="detail-section">
      <h3>価格情報</h3>
      <div style="font-size:14px;">
        <div>前日比: <span class="${pctClass(state.last_change_pct)}">${fmtPct(state.last_change_pct)}</span></div>
        <div style="font-size:12px; opacity:0.7; margin-top:4px;">最終更新: ${state.last_updated_at ? new Date(state.last_updated_at).toLocaleString('ja-JP') : '—'}</div>
      </div>
    </div>

    <div class="detail-section">
      <h3>監視・お気に入り</h3>
      <div style="display:flex; gap:8px;">
        <button class="toggle detail-watch ${state.is_watched ? 'on' : ''}" data-code="${code}">監視: ${state.is_watched ? 'ON' : 'OFF'}</button>
        <button class="toggle detail-favorite ${state.is_favorite ? 'on' : ''}" data-code="${code}">★: ${state.is_favorite ? 'ON' : 'OFF'}</button>
      </div>
    </div>

    <div class="detail-section">
      <h3>通知レベル設定</h3>
      <div style="font-size:13px; margin-bottom:8px;">
        <div>カスタム設定:
          <input type="text" id="custom-levels-${code}" value="${(state.custom_alert_levels || []).join(',')}" placeholder="例: -2,-3,-5,-7" style="width:200px; padding:4px; border:1px solid #8886; border-radius:4px;" />
          <button id="save-custom-levels-${code}" class="btn-primary" style="margin-left:8px;">保存</button>
        </div>
        <div style="font-size:11px; opacity:0.7; margin-top:4px;">空の場合は既定値(${(categoryDefaultLevels(entry) || [-3, -5, -7, -10]).join(', ')}%)を使用</div>
      </div>
    </div>

    ${renderReboundStatsTable(entry)}

    <div class="detail-section">
      <h3>買付計画</h3>
      <div id="plan-list-${code}" style="margin-bottom:8px;"></div>
      <button id="add-plan-btn-${code}" class="btn-primary">計画を追加</button>
    </div>

    <div class="detail-section">
      <h3>投資メモ</h3>
      <textarea id="memo-text-${code}" placeholder="メモを入力してください..." style="width:100%; height:80px; padding:8px; border:1px solid #8886; border-radius:4px; box-sizing:border-box; font-family:inherit; font-size:13px;"></textarea>
      <button id="save-memo-btn-${code}" class="btn-primary" style="margin-top:8px;">メモを保存</button>
    </div>

    <div class="detail-section">
      <h3>直近の通知履歴(10件)</h3>
      <div id="recent-history-${code}"></div>
    </div>

    <div class="detail-section">
      <h3>日次価格履歴(30日)</h3>
      <div style="font-size:12px; max-height:300px; overflow-y:auto;">
        <div id="price-history-${code}"></div>
      </div>
    </div>
  `;

  document.getElementById("detail-content").innerHTML = html;

  // トグルボタンのイベント
  document.querySelector(`.detail-watch[data-code="${code}"]`).addEventListener("click", async () => {
    await updateUserState(code, { is_watched: !state.is_watched });
    await refreshUserStatesCache();
    await showDetail(code);
  });

  document.querySelector(`.detail-favorite[data-code="${code}"]`).addEventListener("click", async () => {
    await updateUserState(code, { is_favorite: !state.is_favorite });
    await refreshUserStatesCache();
    await showDetail(code);
  });

  // 通知レベル保存
  document.getElementById(`save-custom-levels-${code}`).addEventListener("click", async () => {
    const text = document.getElementById(`custom-levels-${code}`).value.trim();
    const levels = text ? text.split(",").map((s) => parseFloat(s.trim())).filter((n) => !isNaN(n)) : null;
    await updateUserState(code, { custom_alert_levels: levels });
    await refreshUserStatesCache();
    alert("保存しました");
    await showDetail(code);
  });

  // メモの読み込みと保存
  const memoTextarea = document.getElementById(`memo-text-${code}`);
  memoTextarea.value = state.memo_text || "";
  
  document.getElementById(`save-memo-btn-${code}`).addEventListener("click", async () => {
    try {
      const memoText = memoTextarea.value;
      await updateUserState(code, { memo_text: memoText });
      alert("メモを保存しました");
    } catch (e) {
      console.error("メモ保存エラー:", e);
      alert("メモの保存に失敗しました");
    }
  });

  // 日次価格履歴(30日) の日付範囲を先に計算
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoffDate = jstDateString(thirtyDaysAgo);

  // ✅ 複数のSupabaseクエリを並行実行（Promise.all）
  const [plansResult, notifResult, priceResult] = await Promise.all([
    sb.from("purchase_plan_item").select("*").eq("code", code).order("level"),
    sb.from("notification_record").select("*").eq("code", code).order("fired_at", { ascending: false }).limit(10),
    sb.from("daily_price").select("*").eq("code", code).gte("date", cutoffDate).order("date", { ascending: false })
  ]);

  const { data: plans, error: plansError } = plansResult;
  const { data: recentNotif, error: notifError } = notifResult;
  const { data: dailyPrices, error: priceError } = priceResult;

  if (plansError) console.error("買付計画読み込みエラー:", plansError);
  if (notifError) console.error("通知履歴取得エラー:", notifError);
  if (priceError) console.error("価格履歴取得エラー:", priceError);

  // 買付計画の表示
  const planDiv = document.getElementById(`plan-list-${code}`);
  if (!plans || plans.length === 0) {
    planDiv.innerHTML = '<div style="opacity:0.7; font-size:12px;">計画が登録されていません</div>';
  } else {
    planDiv.innerHTML = plans
      .map((p) => `
        <div class="plan-row" data-plan-id="${p.id}">
          <span style="min-width:50px;">${p.level}%</span>
          <input type="number" value="${p.amount}" placeholder="金額(円)" class="plan-amount" />
          <input type="text" value="${p.note || ''}" placeholder="メモ" class="plan-note" />
          <button class="plan-save-btn btn-primary" data-plan-id="${p.id}">保存</button>
          <button class="plan-delete-btn btn-delete" data-plan-id="${p.id}">削除</button>
        </div>
      `)
      .join("");

    // 保存・削除イベント
    planDiv.querySelectorAll(".plan-save-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const planId = e.target.dataset.planId;
        const row = e.target.closest(".plan-row");
        const amount = parseInt(row.querySelector(".plan-amount").value) || 0;
        const note = row.querySelector(".plan-note").value;
        try {
          await sb.from("purchase_plan_item").update({ amount, note }).eq("id", planId);
          alert("保存しました");
        } catch (e) {
          console.error("計画保存エラー:", e);
          alert("保存に失敗しました");
        }
      });
    });

    planDiv.querySelectorAll(".plan-delete-btn").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const planId = e.target.dataset.planId;
        if (confirm("削除してもよろしいですか？")) {
          try {
            await sb.from("purchase_plan_item").delete().eq("id", planId);
            await loadAndRenderPlans(code);
          } catch (e) {
            console.error("計画削除エラー:", e);
            alert("削除に失敗しました");
          }
        }
      });
    });
  }

  // 計画追加ボタン
  document.getElementById(`add-plan-btn-${code}`).addEventListener("click", async () => {
    const level = prompt("下落レベル(例: -3)を入力:");
    if (!level) return;
    const parsedLevel = parseFloat(level);
    if (isNaN(parsedLevel)) {
      alert("数値を入力してください");
      return;
    }
    const amount = prompt("購入金額(円)を入力:");
    if (!amount) return;
    const parsedAmount = parseInt(amount);
    if (isNaN(parsedAmount)) {
      alert("数値を入力してください");
      return;
    }
    try {
      await sb.from("purchase_plan_item").insert({ code, level: parsedLevel, amount: parsedAmount, note: "" });
      await loadAndRenderPlans(code);
    } catch (e) {
      console.error("計画追加エラー:", e);
      alert("追加に失敗しました");
    }
  });

  // 通知履歴の表示
  const historyDiv = document.getElementById(`recent-history-${code}`);
  if (!recentNotif || recentNotif.length === 0) {
    historyDiv.innerHTML = '<div style="opacity:0.7; font-size:12px;">通知履歴なし</div>';
  } else {
    historyDiv.innerHTML = recentNotif
      .map((n) => `<div class="timeline-row"><span class="timeline-date">${n.date} ${n.fired_at.slice(11, 16)}</span><span class="timeline-price">${n.level}% (${fmtPct(n.change_pct)})</span></div>`)
      .join("");
  }

  const priceHistDiv = document.getElementById(`price-history-${code}`);
  // 直近3営業日の累積下落率(じわじわ型の目安)
  const cumEntry = catalogCache.find((c) => c.code === code);
  const cumTh = cumulativeThreshold(cumEntry);
  const cumPct = cumulativeChangePct(dailyPrices, CUM_WINDOW_DAYS);
  let cumHtml = "";
  if (cumTh != null && cumPct != null) {
    const hit = cumPct <= cumTh;
    cumHtml = `<div style="font-size:12px; margin-bottom:6px; padding:6px 8px; border-radius:4px; ${hit ? 'background:#d335; font-weight:600;' : 'opacity:0.75;'}">
      直近${CUM_WINDOW_DAYS}営業日の累計: <span class="${pctClass(cumPct)}">${fmtPct(cumPct)}</span>（じわじわ型の目安 ${cumTh}%）${hit ? ' ← 到達' : ''}
    </div>`;
  }
  if (!dailyPrices || dailyPrices.length === 0) {
    priceHistDiv.innerHTML = '<div style="opacity:0.7;">価格履歴なし</div>';
  } else {
    priceHistDiv.innerHTML = cumHtml + dailyPrices
      .map((p) => {
        const bgColor = p.reached_level ? (p.reached_level <= -7 ? '#d335' : p.reached_level <= -5 ? '#f965' : '#ff95') : '';
        return `<div class="timeline-row" style="${bgColor ? `background:${bgColor}; padding:6px 8px; margin:2px 0; border-radius:4px;` : ''}">
          <span class="timeline-date">${p.date}</span>
          <span>${p.close.toFixed(2)}</span>
          <span class="timeline-price ${pctClass(p.change_pct)}">${fmtPct(p.change_pct)}</span>
          ${p.reached_level ? `<span style="font-weight:600; margin-left:auto;">${p.reached_level}%</span>` : ''}
        </div>`;
      })
      .join("");
  }
}

async function updateUserState(code, updates) {
  const state = userStatesByCode[code];
  if (!state) {
    await sb.from("etf_user_state").insert({ code, ...updates });
  } else {
    await sb.from("etf_user_state").update(updates).eq("code", code);
  }
}

// loadAndRenderPlans は showDetail 内に統合済み

["search-box", "filter-expense-max"].forEach((id) => {
  document.getElementById(id).addEventListener("input", applyCatalogView);
});
["filter-category", "filter-theme", "filter-leveraged", "filter-inverse", "sort-select"].forEach((id) => {
  document.getElementById(id).addEventListener("change", applyCatalogView);
});

// 純資産/売買代金スライダー: ドラッグ操作時はキリの良い単位(10億円/100万円)にスナップさせる。
// スライダー自体のstep属性は1のままにしておく(数値入力欄からの正確な値の反映を妨げないため。
// step=10等にすると、JSでの.value代入自体がその倍数に丸められてしまう挙動がある)。
[
  ["filter-aum-min", 10],
  ["filter-turnover-min", 100],
].forEach(([sliderId, snap]) => {
  const sliderEl = document.getElementById(sliderId);
  sliderEl.addEventListener("input", () => {
    const v = Math.round(parseInt(sliderEl.value, 10) / snap) * snap;
    sliderEl.value = v;
    applyCatalogView();
  });
});

// 数値入力欄 <-> スライダーの同期(iPhoneなどスライダー操作がしづらい環境向け)
[
  ["filter-aum-min-num", "filter-aum-min"],
  ["filter-turnover-min-num", "filter-turnover-min"],
].forEach(([numId, sliderId]) => {
  const numEl = document.getElementById(numId);
  const sliderEl = document.getElementById(sliderId);
  numEl.addEventListener("input", () => {
    const min = parseInt(sliderEl.min, 10);
    const max = parseInt(sliderEl.max, 10);
    let v = parseInt(numEl.value, 10);
    if (Number.isNaN(v)) return; // 入力途中(空欄など)は反映しない
    v = Math.min(max, Math.max(min, v));
    sliderEl.value = v;
    applyCatalogView();
  });
});

// ---------- ホーム ----------
async function loadHome() {
  const today = jstDateString();

  const { data: notifications } = await sb
    .from("notification_record")
    .select("*")
    .eq("date", today)
    .order("fired_at", { ascending: false });

  const todayList = document.getElementById("today-list");
  if (!notifications || notifications.length === 0) {
    todayList.className = "empty";
    todayList.textContent = "本日の通知はありません";
  } else {
    todayList.className = "";
    todayList.innerHTML = notifications
      .map((n) => {
        const entry = catalogCache.find((c) => c.code === n.code);
        return `<div class="row" style="cursor:pointer;" data-code="${n.code}">
          <div><div class="name">${entry?.name || n.code}</div>
          <div class="code">${n.level}%到達</div></div>
          <div class="${pctClass(n.change_pct)}">${fmtPct(n.change_pct)}</div></div>`;
      })
      .join("");
    
    // クリックイベント
    todayList.querySelectorAll(".row[data-code]").forEach((row) => {
      row.addEventListener("click", () => {
        showDetail(row.dataset.code);
      });
    });
  }

  const { data: watched } = await sb
    .from("etf_user_state")
    .select("*")
    .eq("is_watched", true)
    .order("last_change_pct", { ascending: true });

  const watchedList = document.getElementById("watched-list");
  if (!watched || watched.length === 0) {
    watchedList.className = "empty";
    watchedList.textContent = "監視中のETFはありません";
  } else {
    watchedList.className = "";
    watchedList.innerHTML = watched
      .map((s) => {
        const entry = catalogCache.find((c) => c.code === s.code);
        return `<div class="row" style="cursor:pointer;" data-code="${s.code}">
          <div><div class="name">${entry?.name || s.code}</div>
          <div class="code">${s.code}</div></div>
          <div class="${pctClass(s.last_change_pct)}">${fmtPct(s.last_change_pct)}</div></div>`;
      })
      .join("");
    
    // クリックイベント
    watchedList.querySelectorAll(".row[data-code]").forEach((row) => {
      row.addEventListener("click", () => {
        showDetail(row.dataset.code);
      });
    });
  }

  const { data: favorites } = await sb.from("etf_user_state").select("*").eq("is_favorite", true);
  const favList = document.getElementById("favorite-list");
  if (!favorites || favorites.length === 0) {
    favList.className = "empty";
    favList.textContent = "お気に入りはありません";
  } else {
    favList.className = "";
    favList.innerHTML = favorites
      .map((s) => {
        const entry = catalogCache.find((c) => c.code === s.code);
        return `<div class="row" style="cursor:pointer;" data-code="${s.code}">
          <div class="name">${entry?.name || s.code}</div>
          <div>${s.last_price ?? "—"}</div></div>`;
      })
      .join("");
    
    // クリックイベント
    favList.querySelectorAll(".row[data-code]").forEach((row) => {
      row.addEventListener("click", () => {
        showDetail(row.dataset.code);
      });
    });
  }
}

// ---------- 通知履歴 ----------
async function loadHistory() {
  const { data } = await sb
    .from("notification_record")
    .select("*")
    .order("date", { ascending: false })
    .order("fired_at", { ascending: false })
    .limit(200);

  const container = document.getElementById("history-list");
  if (!data || data.length === 0) {
    container.className = "empty";
    container.textContent = "通知履歴はまだありません";
    return;
  }
  container.className = "";
  container.innerHTML = data
    .map((n) => {
      const entry = catalogCache.find((c) => c.code === n.code);
      return `<div class="row" style="cursor:pointer;" data-code="${n.code}">
        <div><div class="name">${entry?.name || n.code}</div>
        <div class="code">${n.date}</div></div>
        <div>${n.level}% (${fmtPct(n.change_pct)})</div></div>`;
    })
    .join("");
  
  // クリックイベント
  container.querySelectorAll(".row[data-code]").forEach((row) => {
    row.addEventListener("click", () => {
      showDetail(row.dataset.code);
    });
  });
}

// ---------- 設定 ----------
async function loadSettings() {
  const { data } = await sb.from("app_settings").select("*").eq("id", 1).single();
  if (data) {
    document.getElementById("default-levels").value = (data.default_alert_levels || []).join(",");
  }
}

document.getElementById("save-levels").addEventListener("click", async () => {
  const text = document.getElementById("default-levels").value;
  const levels = text
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .filter((n) => !isNaN(n));
  if (levels.length === 0) return;
  await sb.from("app_settings").update({ default_alert_levels: levels }).eq("id", 1);
  alert("保存しました");
});

// ---------- プッシュ通知登録 ----------
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

// Markdownエクスポート機能
document.getElementById("export-markdown-btn").addEventListener("click", async () => {
  const watched = (await sb.from("etf_user_state").select("*").eq("is_watched", true)) .data || [];
  
  if (watched.length === 0) {
    alert("監視中のETFがありません");
    return;
  }

  let markdown = `# ETF投資状況 - ${new Date().toLocaleDateString('ja-JP')}\n\n`;
  markdown += `このデータは、下記のETFについてのあなたの投資計画・メモ・通知レベルをまとめたものです。\n`;
  markdown += `AIに分析させる場合は、このテキストをコピーして ChatGPT や Claude に貼り付けてください。\n\n`;
  markdown += `---\n\n`;

  for (const state of watched) {
    const entry = catalogCache.find((c) => c.code === state.code);
    if (!entry) continue;

    markdown += `## ${entry.name} (${entry.code})\n\n`;
    markdown += `- 運用会社: ${entry.issuer}\n`;
    markdown += `- 連動指数: ${entry.index_name}\n`;
    markdown += `- 信託報酬: ${entry.expense_ratio?.toFixed(3)}%\n`;
    markdown += `- 通知レベル: ${(state.custom_alert_levels || [-3, -5, -7, -10]).join(', ')}%\n\n`;

    // 買付計画
    if (state.purchase_plan_item && state.purchase_plan_item.length > 0) {
      markdown += `### 買付計画\n`;
      for (const plan of state.purchase_plan_item) {
        markdown += `- ${plan.level}%下落時: ¥${plan.amount.toLocaleString()}${plan.note ? ` (${plan.note})` : ''}\n`;
      }
      markdown += '\n';
    }

    // メモ
    if (state.memo_text) {
      markdown += `### メモ\n${state.memo_text}\n\n`;
    }

    markdown += '---\n\n';
  }

  // テキストをクリップボードにコピー＆ダウンロード
  const blob = new Blob([markdown], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `etf-export-${jstDateString()}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  alert('Markdownをダウンロードしました！\nこのテキストを ChatGPT や Claude に貼り付けて分析させてください。');
});

document.getElementById("enable-push").addEventListener("click", async () => {
  const statusEl = document.getElementById("push-status");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    statusEl.textContent = "この端末・ブラウザは通知に対応していません(iPhoneの場合はホーム画面に追加してから開いてください)";
    return;
  }
  try {
    const reg = await navigator.serviceWorker.register("service-worker.js");
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      statusEl.textContent = "通知が許可されませんでした";
      return;
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });
    const json = sub.toJSON();
    await sb.from("push_subscription").upsert(
      { endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      { onConflict: "endpoint" }
    );
    statusEl.textContent = "この端末で通知を受け取れるようになりました";
  } catch (e) {
    console.error(e);
    statusEl.textContent = "登録に失敗しました: " + e.message;
  }
});

// テスト通知送信
document.getElementById("send-test-notification").addEventListener("click", async () => {
  const statusEl = document.getElementById("test-status");
  statusEl.textContent = "送信中...";
  try {
    // サービスワーカーを通じてローカル通知を送信(実装パターン1: Service Workerに直接送信)
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "SEND_TEST_NOTIFICATION",
        title: "テスト通知",
        body: "このメッセージが表示されたら、プッシュ通知が正常に動作しています。\n(前日比 -5.0% / -5%到達の例)"
      });
      statusEl.textContent = "テスト通知を送信しました。数秒以内に表示されます。";
      setTimeout(() => { statusEl.textContent = ""; }, 5000);
    } else {
      statusEl.textContent = "Service Workerが登録されていません。先に「この端末で通知を受け取る」ボタンを押してください。";
    }
  } catch (e) {
    console.error(e);
    statusEl.textContent = "送信に失敗しました: " + e.message;
  }
});

// テスト通知(クイック版): Notification API直接使用
if ("Notification" in window && Notification.permission === "granted") {
  // 登録済みの場合のみ動作
}

// ---------- 初期化 ----------
(async function init() {
  await loadCatalog();
  await loadSettings();
  await loadHome();

  // URLパラメータから自動で詳細画面を開く(通知タップ時など)
  const params = new URLSearchParams(window.location.search);
  const codeParam = params.get("code") || params.get("etf");
  
  if (codeParam) {
    // コードが有効か確認
    const validCode = codeParam.trim().toUpperCase();
    if (catalogCache.find((c) => c.code === validCode)) {
      await showDetail(validCode);
    } else if (catalogCache.find((c) => c.code.includes(validCode))) {
      // 部分一致で検索
      const found = catalogCache.find((c) => c.code.includes(validCode));
      if (found) await showDetail(found.code);
    }
  }
})();
