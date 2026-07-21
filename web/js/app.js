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

// ---------- カタログ ----------
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
  if (!state || !state.is_watched || state.last_change_pct == null) {
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
        <div style="font-size:11px; opacity:0.7; margin-top:4px;">空の場合は既定値を使用</div>
      </div>
    </div>

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
  const cutoffDate = thirtyDaysAgo.toISOString().slice(0, 10);

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
  if (!dailyPrices || dailyPrices.length === 0) {
    priceHistDiv.innerHTML = '<div style="opacity:0.7;">価格履歴なし</div>';
  } else {
    priceHistDiv.innerHTML = dailyPrices
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

// ---------- ホーム ----------
async function loadHome() {
  const today = new Date().toISOString().slice(0, 10);

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
  a.download = `etf-export-${new Date().toISOString().slice(0, 10)}.md`;
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
