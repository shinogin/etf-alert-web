// ============================================================
//  売買記録モジュール (trades.js)
//  app.js には手を加えず、この1ファイルで完結させる
// ============================================================

const tsb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const POSITION_LABELS = {
  margin_long: "信用買い",
  cash_long: "現物買い",
  margin_short: "信用売り",
};

// アプリ内で実際に使われている通知レベルの全種類(既定値+カテゴリ別既定値の和集合)
const ALERT_LEVEL_OPTIONS = [-2, -3, -5, -7, -8, -10];

// ---------- ユーティリティ ----------
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function yen(n) {
  if (n == null) return "—";
  return (n < 0 ? "−" : "") + "¥" + Math.abs(Math.round(n)).toLocaleString();
}

function signPct(n) {
  if (n == null) return "—";
  return (n > 0 ? "+" : "") + Number(n).toFixed(2) + "%";
}

function pnlClass(n) {
  if (n == null) return "";
  return n > 0 ? "pnl-plus" : n < 0 ? "pnl-minus" : "";
}

function daysSince(dateStr) {
  const ms = new Date(todayStr()) - new Date(dateStr);
  return Math.round(ms / 86400000);
}

function catalogName(code) {
  const e = (typeof catalogCache !== "undefined" ? catalogCache : []).find(
    (c) => c.code === code
  );
  return e ? e.name : "";
}

function alertLevelOptionsHtml(selected) {
  const sel = selected == null || selected === "" ? "" : Number(selected);
  let html = `<option value="" ${sel === "" ? "selected" : ""}>選択なし</option>`;
  html += ALERT_LEVEL_OPTIONS.map(
    (lvl) => `<option value="${lvl}" ${sel === lvl ? "selected" : ""}>${lvl}%</option>`
  ).join("");
  return html;
}

// ---------- 描画 ----------
let tradesCache = [];

async function loadTrades() {
  const root = document.getElementById("trades-body");
  root.innerHTML = '<div class="empty">読み込み中…</div>';

  const [{ data: rows, error }, { data: statsRows }] = await Promise.all([
    tsb.from("trade_record").select("*").order("entry_date", { ascending: false }),
    tsb.from("trade_stats").select("*").limit(1),
  ]);

  if (error) {
    root.innerHTML =
      '<div class="empty">読み込みに失敗しました。<br/>Supabaseで trade_record を作成しましたか？<br/><small>' +
      error.message +
      "</small></div>";
    return;
  }

  const trades = rows || [];
  tradesCache = trades;
  const open = trades.filter((t) => !t.is_closed);
  const closed = trades.filter((t) => t.is_closed);

  // 未決済分の現在価格を取得して含み損益を計算
  let priceByCode = {};
  if (open.length > 0) {
    const codes = [...new Set(open.map((t) => t.code))];
    const { data: states } = await tsb
      .from("etf_user_state")
      .select("code,last_price,last_change_pct")
      .in("code", codes);
    (states || []).forEach((s) => (priceByCode[s.code] = s));
  }

  const st = (statsRows && statsRows[0]) || {};
  let unrealized = 0;
  open.forEach((t) => {
    const p = priceByCode[t.code]?.last_price;
    if (p != null) {
      const dir = t.position_type === "margin_short" ? -1 : 1;
      unrealized += dir * (p - t.entry_price) * t.quantity;
    }
  });

  let html = "";

  // --- サマリー ---
  html += '<div class="card trade-summary">';
  html += "<h3>成績サマリー</h3>";
  html += '<div class="stat-grid">';
  html += statCell("確定損益", yen(st.total_pnl), pnlClass(st.total_pnl));
  html += statCell("含み損益", yen(unrealized), pnlClass(unrealized));
  html += statCell("勝率", st.win_rate_pct != null ? st.win_rate_pct + "%" : "—");
  html += statCell("決済回数", (st.closed_trades ?? 0) + "回");
  html += statCell("平均リターン", signPct(st.avg_return_pct), pnlClass(st.avg_return_pct));
  html += statCell("平均保有", st.avg_holding_days != null ? st.avg_holding_days + "日" : "—");
  html += "</div></div>";

  // --- 新規記録ボタン ---
  html +=
    '<button id="trade-new-btn" class="btn-primary" style="width:100%;margin:12px 0;">＋ 新しい建玉を記録</button>';
  html += '<div id="trade-form-wrap"></div>';

  // --- 保有中 ---
  html += `<h2 style="font-size:16px;margin-top:20px;">保有中 (${open.length})</h2>`;
  if (open.length === 0) {
    html += '<div class="empty">保有中の建玉はありません</div>';
  } else {
    open.forEach((t) => {
      const cur = priceByCode[t.code]?.last_price;
      const dir = t.position_type === "margin_short" ? -1 : 1;
      const up = cur != null ? dir * (cur - t.entry_price) * t.quantity : null;
      const upPct = cur != null ? (dir * (cur - t.entry_price) / t.entry_price) * 100 : null;
      html += '<div class="card trade-card">';
      html += `<div class="trade-head"><span class="name">${t.name || catalogName(t.code)}</span>
               <span class="code">${t.code}</span></div>`;
      html += `<div class="meta">${POSITION_LABELS[t.position_type] || t.position_type}
               ${t.alert_level != null ? `／ ${t.alert_level}%アラート発` : ""}</div>`;
      html += `<div class="trade-line">建玉 ${t.entry_date}　${t.entry_price.toLocaleString()}円 × ${t.quantity}株
               <span class="meta">(${daysSince(t.entry_date)}日経過)</span></div>`;
      html += `<div class="trade-line">現在 ${cur != null ? cur.toLocaleString() + "円" : "—"}
               　<span class="${pnlClass(up)}">${yen(up)}　${signPct(upPct)}</span></div>`;
      if (t.memo) html += `<div class="meta">${t.memo}</div>`;
      html += `<div style="display:flex;gap:8px;margin-top:8px;">`;
      html += `<button class="toggle trade-close-btn" data-id="${t.id}" style="flex:1;">返済を記録</button>`;
      html += `<button class="toggle trade-edit-btn" data-id="${t.id}" style="flex:1;">編集</button>`;
      html += `</div>`;
      html += "</div>";
    });
  }

  // --- 決済済み ---
  html += `<h2 style="font-size:16px;margin-top:20px;">決済済み (${closed.length})</h2>`;
  if (closed.length === 0) {
    html += '<div class="empty">まだありません</div>';
  } else {
    closed.forEach((t) => {
      html += '<div class="card trade-card">';
      html += `<div class="trade-head"><span class="name">${t.name || catalogName(t.code)}</span>
               <span class="code">${t.code}</span></div>`;
      html += `<div class="trade-line">${t.entry_date} → ${t.exit_date}　<span class="meta">${t.holding_days}日</span></div>`;
      html += `<div class="trade-line">${t.entry_price.toLocaleString()} → ${t.exit_price.toLocaleString()}円 × ${t.quantity}株</div>`;
      html += `<div class="trade-line ${pnlClass(t.pnl)}" style="font-weight:600;">${yen(t.pnl)}　${signPct(t.return_pct)}</div>`;
      if (t.memo) html += `<div class="meta">${t.memo}</div>`;
      html += `<div style="display:flex;gap:8px;margin-top:8px;">`;
      html += `<button class="toggle trade-edit-btn" data-id="${t.id}" style="flex:1;">編集</button>`;
      html += `<button class="toggle btn-delete trade-del-btn" data-id="${t.id}" style="flex:1;">削除</button>`;
      html += `</div>`;
      html += "</div>";
    });
  }

  root.innerHTML = html;
  wireTradeEvents();
}

function statCell(label, value, cls = "") {
  return `<div class="stat-cell"><div class="stat-label">${label}</div>
          <div class="stat-value ${cls}">${value}</div></div>`;
}

// ---------- イベント配線 ----------
function wireTradeEvents() {
  document.getElementById("trade-new-btn")?.addEventListener("click", showTradeForm);
  document.querySelectorAll(".trade-close-btn").forEach((b) =>
    b.addEventListener("click", () => showCloseForm(Number(b.dataset.id)))
  );
  document.querySelectorAll(".trade-del-btn").forEach((b) =>
    b.addEventListener("click", () => deleteTrade(Number(b.dataset.id)))
  );
  document.querySelectorAll(".trade-edit-btn").forEach((b) =>
    b.addEventListener("click", () => {
      const t = tradesCache.find((x) => x.id === Number(b.dataset.id));
      if (t) showEditForm(t);
    })
  );
}

// ---------- 新規建玉フォーム ----------
function showTradeForm(prefill = {}) {
  const wrap = document.getElementById("trade-form-wrap");
  const cat = typeof catalogCache !== "undefined" ? catalogCache : [];
  const options = cat
    .map((c) => `<option value="${c.code}">${c.code} ${c.name}</option>`)
    .join("");

  wrap.innerHTML = `
    <div class="card">
      <h3>新しい建玉</h3>
      <label class="f-label">銘柄コード</label>
      <input id="tf-code" list="tf-code-list" class="f-input" placeholder="1306" value="${prefill.code || ""}" />
      <datalist id="tf-code-list">${options}</datalist>

      <label class="f-label">取引種別</label>
      <select id="tf-type" class="f-input">
        <option value="margin_long">信用買い</option>
        <option value="cash_long">現物買い</option>
        <option value="margin_short">信用売り</option>
      </select>

      <label class="f-label">建玉日</label>
      <input id="tf-date" type="date" class="f-input" value="${prefill.date || todayStr()}" />

      <label class="f-label">約定価格（円）</label>
      <input id="tf-price" type="number" step="0.1" inputmode="decimal" class="f-input" value="${prefill.price || ""}" />

      <label class="f-label">株数</label>
      <input id="tf-qty" type="number" step="1" inputmode="numeric" class="f-input" value="${prefill.qty || ""}" />

      <label class="f-label">きっかけのアラートレベル（任意）</label>
      <select id="tf-level" class="f-input">${alertLevelOptionsHtml(prefill.level)}</select>

      <label class="f-label">メモ（任意）</label>
      <input id="tf-memo" type="text" class="f-input" placeholder="リバウンド狙い" />

      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="tf-save" class="btn-primary" style="flex:1;">保存</button>
        <button id="tf-cancel" class="toggle" style="flex:1;">やめる</button>
      </div>
    </div>`;

  document.getElementById("tf-cancel").addEventListener("click", () => (wrap.innerHTML = ""));
  document.getElementById("tf-save").addEventListener("click", saveTrade);
  wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function saveTrade() {
  const code = document.getElementById("tf-code").value.trim();
  const price = parseFloat(document.getElementById("tf-price").value);
  const qty = parseInt(document.getElementById("tf-qty").value, 10);
  const levelRaw = document.getElementById("tf-level").value;
  const memo = document.getElementById("tf-memo").value.trim();

  if (!code || !(price > 0) || !(qty > 0)) {
    alert("銘柄コード・約定価格・株数は必須です");
    return;
  }

  const btn = document.getElementById("tf-save");
  btn.disabled = true;
  btn.textContent = "保存中…";

  const { error } = await tsb.from("trade_record").insert({
    code,
    name: catalogName(code) || null,
    position_type: document.getElementById("tf-type").value,
    alert_level: levelRaw === "" ? null : parseFloat(levelRaw),
    entry_date: document.getElementById("tf-date").value,
    entry_price: price,
    quantity: qty,
    memo: memo || null,
  });

  if (error) {
    alert("保存に失敗しました: " + error.message);
    btn.disabled = false;
    btn.textContent = "保存";
    return;
  }
  document.getElementById("trade-form-wrap").innerHTML = "";
  await loadTrades();
}

// ---------- 返済フォーム ----------
function showCloseForm(id) {
  const wrap = document.getElementById("trade-form-wrap");
  wrap.innerHTML = `
    <div class="card">
      <h3>返済を記録</h3>
      <label class="f-label">返済日</label>
      <input id="cf-date" type="date" class="f-input" value="${todayStr()}" />
      <label class="f-label">約定価格（円）</label>
      <input id="cf-price" type="number" step="0.1" inputmode="decimal" class="f-input" />
      <label class="f-label">手数料＋金利の合計（円）</label>
      <input id="cf-fee" type="number" step="1" inputmode="numeric" class="f-input" value="0" />
      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="cf-save" class="btn-primary" style="flex:1;">保存</button>
        <button id="cf-cancel" class="toggle" style="flex:1;">やめる</button>
      </div>
    </div>`;
  document.getElementById("cf-cancel").addEventListener("click", () => (wrap.innerHTML = ""));
  document.getElementById("cf-save").addEventListener("click", async () => {
    const price = parseFloat(document.getElementById("cf-price").value);
    if (!(price > 0)) {
      alert("約定価格を入力してください");
      return;
    }
    const { error } = await tsb
      .from("trade_record")
      .update({
        exit_date: document.getElementById("cf-date").value,
        exit_price: price,
        fee: parseInt(document.getElementById("cf-fee").value || "0", 10),
      })
      .eq("id", id);
    if (error) {
      alert("保存に失敗しました: " + error.message);
      return;
    }
    wrap.innerHTML = "";
    await loadTrades();
  });
  wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

// ---------- 編集フォーム（入力ミスの修正用） ----------
function showEditForm(t) {
  const wrap = document.getElementById("trade-form-wrap");
  const cat = typeof catalogCache !== "undefined" ? catalogCache : [];
  const options = cat
    .map((c) => `<option value="${c.code}">${c.code} ${c.name}</option>`)
    .join("");

  const exitFieldsHtml = t.is_closed
    ? `
      <label class="f-label">返済日</label>
      <input id="ef-exit-date" type="date" class="f-input" value="${t.exit_date || ""}" />

      <label class="f-label">返済価格（円）</label>
      <input id="ef-exit-price" type="number" step="0.1" inputmode="decimal" class="f-input" value="${t.exit_price ?? ""}" />

      <label class="f-label">手数料＋金利の合計（円）</label>
      <input id="ef-fee" type="number" step="1" inputmode="numeric" class="f-input" value="${t.fee ?? 0}" />
    `
    : "";

  wrap.innerHTML = `
    <div class="card">
      <h3>記録を編集</h3>
      <label class="f-label">銘柄コード</label>
      <input id="ef-code" list="ef-code-list" class="f-input" value="${t.code}" />
      <datalist id="ef-code-list">${options}</datalist>

      <label class="f-label">取引種別</label>
      <select id="ef-type" class="f-input">
        <option value="margin_long" ${t.position_type === "margin_long" ? "selected" : ""}>信用買い</option>
        <option value="cash_long" ${t.position_type === "cash_long" ? "selected" : ""}>現物買い</option>
        <option value="margin_short" ${t.position_type === "margin_short" ? "selected" : ""}>信用売り</option>
      </select>

      <label class="f-label">建玉日</label>
      <input id="ef-date" type="date" class="f-input" value="${t.entry_date}" />

      <label class="f-label">約定価格（円）</label>
      <input id="ef-price" type="number" step="0.1" inputmode="decimal" class="f-input" value="${t.entry_price}" />

      <label class="f-label">株数</label>
      <input id="ef-qty" type="number" step="1" inputmode="numeric" class="f-input" value="${t.quantity}" />

      <label class="f-label">きっかけのアラートレベル（任意）</label>
      <select id="ef-level" class="f-input">${alertLevelOptionsHtml(t.alert_level)}</select>

      <label class="f-label">メモ（任意）</label>
      <input id="ef-memo" type="text" class="f-input" value="${(t.memo || "").replace(/"/g, "&quot;")}" />

      ${exitFieldsHtml}

      <div style="display:flex;gap:8px;margin-top:12px;">
        <button id="ef-save" class="btn-primary" style="flex:1;">保存</button>
        <button id="ef-cancel" class="toggle" style="flex:1;">やめる</button>
      </div>
    </div>`;

  document.getElementById("ef-cancel").addEventListener("click", () => (wrap.innerHTML = ""));
  document.getElementById("ef-save").addEventListener("click", () => saveEdit(t));
  wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function saveEdit(original) {
  const code = document.getElementById("ef-code").value.trim();
  const price = parseFloat(document.getElementById("ef-price").value);
  const qty = parseInt(document.getElementById("ef-qty").value, 10);
  const levelRaw = document.getElementById("ef-level").value;

  if (!code || !(price > 0) || !(qty > 0)) {
    alert("銘柄コード・約定価格・株数は必須です");
    return;
  }

  const updates = {
    code,
    name: catalogName(code) || original.name,
    position_type: document.getElementById("ef-type").value,
    alert_level: levelRaw === "" ? null : parseFloat(levelRaw),
    entry_date: document.getElementById("ef-date").value,
    entry_price: price,
    quantity: qty,
    memo: document.getElementById("ef-memo").value || null,
  };

  if (original.is_closed) {
    const exitPrice = parseFloat(document.getElementById("ef-exit-price").value);
    if (!(exitPrice > 0)) {
      alert("返済価格を入力してください");
      return;
    }
    updates.exit_date = document.getElementById("ef-exit-date").value;
    updates.exit_price = exitPrice;
    updates.fee = parseInt(document.getElementById("ef-fee").value || "0", 10);
  }

  const btn = document.getElementById("ef-save");
  btn.disabled = true;
  btn.textContent = "保存中…";

  const { error } = await tsb.from("trade_record").update(updates).eq("id", original.id);

  if (error) {
    alert("保存に失敗しました: " + error.message);
    btn.disabled = false;
    btn.textContent = "保存";
    return;
  }
  document.getElementById("trade-form-wrap").innerHTML = "";
  await loadTrades();
}

async function deleteTrade(id) {
  if (!confirm("この記録を削除しますか？")) return;
  const { error } = await tsb.from("trade_record").delete().eq("id", id);
  if (error) {
    alert("削除に失敗しました: " + error.message);
    return;
  }
  await loadTrades();
}

// ---------- タブ連携（app.js には触らない） ----------
document.querySelector('nav button[data-tab="trades"]')?.addEventListener("click", loadTrades);

// 詳細画面から呼べるようにグローバル公開
window.openTradeFormFor = function (code, price, level) {
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll("section").forEach((s) => s.classList.remove("active"));
  document.querySelector('nav button[data-tab="trades"]').classList.add("active");
  document.getElementById("trades").classList.add("active");
  loadTrades().then(() => showTradeForm({ code, price, level }));
};
