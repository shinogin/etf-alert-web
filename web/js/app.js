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
  await refreshUserStatesCache();
  applyCatalogView();
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

function applyCatalogView() {
  const q = document.getElementById("search-box").value.trim().toLowerCase();
  const category = document.getElementById("filter-category").value;
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

["search-box"].forEach((id) => {
  document.getElementById(id).addEventListener("input", applyCatalogView);
});
["filter-category", "filter-leveraged", "filter-inverse", "sort-select"].forEach((id) => {
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
        return `<div class="row"><div><div class="name">${entry?.name || n.code}</div>
          <div class="code">${n.level}%到達</div></div>
          <div class="${pctClass(n.change_pct)}">${fmtPct(n.change_pct)}</div></div>`;
      })
      .join("");
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
        return `<div class="row"><div><div class="name">${entry?.name || s.code}</div>
          <div class="code">${s.code}</div></div>
          <div class="${pctClass(s.last_change_pct)}">${fmtPct(s.last_change_pct)}</div></div>`;
      })
      .join("");
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
        return `<div class="row"><div class="name">${entry?.name || s.code}</div>
          <div>${s.last_price ?? "—"}</div></div>`;
      })
      .join("");
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
      return `<div class="row"><div><div class="name">${entry?.name || n.code}</div>
        <div class="code">${n.date}</div></div>
        <div>${n.level}% (${fmtPct(n.change_pct)})</div></div>`;
    })
    .join("");
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

// ---------- 初期化 ----------
(async function init() {
  await loadCatalog();
  await loadSettings();
  await loadHome();
})();
