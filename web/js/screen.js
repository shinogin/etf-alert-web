// ---------- 優位性スクリーニング ----------
// 全銘柄を「20営業日の高値から何%下にいるか」と「市場全体がどれだけ下げているか」で
// 優位性の段階に分け、タブで一覧・絞り込みできるようにする。
//
// 根拠: 2026-10 実施の全ETF10年バックテスト(336銘柄・売買代金1千万円以上、
// 同一銘柄は10営業日に1回まで数えて重複を除いた)。株式ETF(指数系+テーマ系)の結果:
//   段階            63日以内に+6%到達  63日後に利益  63日後の中央値
//   強                   90%            88%          +11.8%
//   中                   78%            83%          +7.0%
//   弱                   71%            70%          +4.8%
//   なし(基準)           59%            69%          +4.2%
//   注意(単独の下げ)      63%            49%          -0.3%
// ・同じ深さの下げでも、市場全体が下げているとき(多くの銘柄が一斉に下げた局面)は戻りやすく、
//   その銘柄だけが下げているときは戻りにくい(下げ続けることが多い)。
// ・「強」は2018〜2026年の23か月で発生し、2022年の下げ相場でも+6%到達91%と安定していた。
// ・株式2倍型は単独の下げでも成績が崩れにくいので「注意」は付けない。
// ・コモディティ・インバース・債券・REITは下落時の買いに優位性がないため対象外。

const SCREEN_TIERS = [
  { key: "strong", label: "強", color: "#1e8a3e", reach: 90, win: 88, med: 11.8,
    desc: "高値から-10%以上 かつ 市場全体も大きく下げている" },
  { key: "mid", label: "中", color: "#5aa83a", reach: 78, win: 83, med: 7.0,
    desc: "高値から-7〜-10% かつ 市場全体も大きく下げている" },
  { key: "weak", label: "弱", color: "#d98b00", reach: 71, win: 70, med: 4.8,
    desc: "高値から-7%以上だが、市場全体の下げは限定的" },
  { key: "caution", label: "注意", color: "#c0392b", reach: 63, win: 49, med: -0.3,
    desc: "高値から-10%以上なのに、市場全体はほとんど下げていない(単独の下げ)" },
  { key: "none", label: "なし", color: "#888", reach: 59, win: 69, med: 4.2,
    desc: "高値からの下げが-7%未満(適当な日に買うのと同程度)" },
  { key: "out", label: "対象外", color: "#555", reach: null, win: null, med: null,
    desc: "コモディティ・インバース・債券・REIT(下落時の買いに優位性がない分類)" },
];
const SCREEN_TIER_BY_KEY = Object.fromEntries(SCREEN_TIERS.map((t) => [t.key, t]));

// 株式2倍型の段階別成績(同じバックテスト・2倍型12銘柄)。値動きが大きいので+6%には届きやすく、
// 途中の下げも大きい(どの段階でも下位1割は-28〜-33%)。
const LEV_TIER_INFO = {
  strong: { reach: 96, win: 82, med: 11.2, desc: "2倍型: 高値から-10%以上 かつ 市場全体も大きく下げている" },
  mid: { reach: 82, win: 76, med: 8.3, desc: "2倍型: 高値から-10%以上(または-7%以上で市場全体も下げている)" },
  weak: { reach: 80, win: 63, med: 5.1, desc: "2倍型: 高値から-7〜-10%" },
  none: { reach: 69, win: 60, med: 4.3, desc: "2倍型: 高値からの下げが-7%未満" },
};
// 銘柄の分類に合わせた段階情報(2倍型は2倍型の成績を使う)
function tierInfo(tierKey, profile) {
  const t = SCREEN_TIER_BY_KEY[tierKey];
  return profile === "equity_lev" && LEV_TIER_INFO[tierKey] ? { ...t, ...LEV_TIER_INFO[tierKey] } : t;
}

// 市場全体の下げ度合い = 株式ETF(売買代金1千万円以上)のうち、20日高値から-10%以下にいる割合(%)
function breadthLabel(br) {
  if (br == null) return "—";
  if (br >= 50) return "全面安";
  if (br >= 20) return "広い下げ";
  if (br >= 5) return "一部で下げ";
  return "平常(個別の下げのみ)";
}

function classifyTier(profile, dd20, br) {
  if (profile !== "equity" && profile !== "equity_lev") return "out";
  if (dd20 == null) return "none";
  const broad = br != null && br >= 20;
  if (profile === "equity_lev") {
    if (dd20 <= -10 && broad) return "strong";
    if (dd20 <= -10 || (dd20 <= -7 && broad)) return "mid";
    if (dd20 <= -7) return "weak";
    return "none";
  }
  if (dd20 <= -10 && broad) return "strong";
  if (dd20 <= -7 && broad) return "mid";
  if (dd20 <= -10 && br != null && br < 5) return "caution";
  if (dd20 <= -7) return "weak";
  return "none";
}

const SCREEN_LOOKBACK = 21; // 当日を含む21営業日(=20営業日前までの高値)
const SCREEN_MIN_TURNOVER = 1e7;
let screenCache = null; // { at, asOf, items, breadth, nDays }
let screenLoading = null;

async function loadScreenData(force = false) {
  if (!force && screenCache && Date.now() - screenCache.at < 10 * 60 * 1000) return screenCache;
  if (screenLoading) return screenLoading;
  screenLoading = (async () => {
    if (!catalogCache.length) await loadCatalog();
    // 売買代金(last_turnover)と監視フラグに使う
    if (!userStatesCache.length) await refreshUserStatesCache();
    // 営業日の一覧は、毎日必ず記録される大型ETF(1306)の履歴から拾う
    const { data: dateRows } = await sb
      .from("daily_price").select("date").eq("code", "1306")
      .order("date", { ascending: false }).limit(SCREEN_LOOKBACK + 4);
    const dates = (dateRows || []).map((r) => r.date);
    const perDate = await Promise.all(
      dates.map((d) => sb.from("daily_price").select("code, close, change_pct").eq("date", d).limit(1000))
    );
    // 全銘柄スキャンが走りきる前の日など、行数が極端に少ない日は除く
    const maxRows = Math.max(0, ...perDate.map((p) => (p.data || []).length));
    const usable = dates
      .map((d, i) => ({ date: d, rows: perDate[i].data || [] }))
      .filter((x) => x.rows.length >= maxRows * 0.5)
      // 祝日に前日の値がそのまま記録された日(ほぼ全銘柄が前日比0%)は営業日として数えない
      .filter((x) => x.rows.filter((r) => r.change_pct === 0).length < x.rows.length * 0.8)
      .slice(0, SCREEN_LOOKBACK);

    const byCode = {};
    usable.forEach((day) => {
      day.rows.forEach((r) => {
        if (r.close == null) return;
        (byCode[r.code] ||= []).push({ date: day.date, close: r.close, change_pct: r.change_pct });
      });
    });

    const items = [];
    for (const entry of catalogCache) {
      const rows = byCode[entry.code]; // 日付降順
      if (!rows || rows.length < 6) continue;
      const cur = rows[0].close;
      const hi = Math.max(...rows.map((r) => r.close));
      const dd20 = (cur / hi - 1) * 100;
      const chg5 = (cur / rows[5].close - 1) * 100;
      const state = userStatesByCode[entry.code] || {};
      items.push({
        entry,
        profile: dropProfile(entry),
        dd20,
        chg5,
        chgToday: rows[0].change_pct,
        date: rows[0].date,
        turnover: state.last_turnover ?? null,
        watched: !!state.is_watched,
        nDays: rows.length,
      });
    }

    const eq = items.filter(
      (i) => i.profile === "equity" && categoryDefaultLevels(i.entry) && (i.turnover ?? 0) >= SCREEN_MIN_TURNOVER
    );
    const breadth = eq.length ? (eq.filter((i) => i.dd20 <= -10).length / eq.length) * 100 : null;
    items.forEach((i) => (i.tier = classifyTier(i.profile, i.dd20, breadth)));

    screenCache = { at: Date.now(), asOf: usable[0]?.date, items, breadth, nDays: usable.length, eqCount: eq.length };
    return screenCache;
  })();
  try {
    return await screenLoading;
  } finally {
    screenLoading = null;
  }
}

const screenFilter = { tiers: new Set(["strong", "mid", "weak", "caution"]), liquidOnly: true, watchedOnly: false };

async function renderScreen(force = false) {
  const el = document.getElementById("screen-body");
  if (!el) return;
  if (!screenCache || force) el.innerHTML = '<div class="empty">集計中…(全銘柄の約1か月分を読み込んでいます)</div>';
  const data = await loadScreenData(force);

  const base = data.items.filter(
    (i) =>
      (!screenFilter.liquidOnly || (i.turnover ?? 0) >= SCREEN_MIN_TURNOVER) &&
      (!screenFilter.watchedOnly || i.watched)
  );
  const counts = Object.fromEntries(SCREEN_TIERS.map((t) => [t.key, base.filter((i) => i.tier === t.key).length]));
  const order = Object.fromEntries(SCREEN_TIERS.map((t, k) => [t.key, k]));
  const list = base
    .filter((i) => screenFilter.tiers.has(i.tier))
    .sort((a, b) => order[a.tier] - order[b.tier] || a.dd20 - b.dd20);

  const br = data.breadth;
  const brColor = br >= 20 ? "#1e8a3e" : br >= 5 ? "#d98b00" : "#888";
  let html = `
    <div class="card">
      <div style="font-size:12px; opacity:0.7;">市場全体の状態(${data.asOf || "—"}時点)</div>
      <div style="display:flex; flex-wrap:wrap; align-items:baseline; column-gap:10px; margin-top:4px;">
        <span style="font-size:20px; font-weight:700; white-space:nowrap; color:${brColor};">${breadthLabel(br)}</span>
        <span style="font-size:13px;">高値から-10%以下の株式ETF: <strong>${br != null ? br.toFixed(1) + "%" : "—"}</strong>(${data.eqCount}銘柄中)</span>
      </div>
      <div style="font-size:11px; opacity:0.7; margin-top:6px; line-height:1.6;">
        20%以上で「広い下げ」。同じ深さの下げでも、市場全体が下げている局面の方が過去は戻りやすく、その銘柄だけが下げている場合は戻りにくい傾向でした。
      </div>
    </div>
    <div class="filter-bar" style="margin:8px 0;">
      ${SCREEN_TIERS.map(
        (t) => `<button class="toggle screen-tier ${screenFilter.tiers.has(t.key) ? "on" : ""}" data-tier="${t.key}"
          style="${screenFilter.tiers.has(t.key) ? `background:${t.color}; border-color:${t.color}; color:#fff;` : ""}">${t.label} ${counts[t.key]}</button>`
      ).join("")}
      <label class="filter-check"><input type="checkbox" id="screen-liquid" ${screenFilter.liquidOnly ? "checked" : ""}/> 売買代金1,000万円以上</label>
      <label class="filter-check"><input type="checkbox" id="screen-watched" ${screenFilter.watchedOnly ? "checked" : ""}/> 監視中のみ</label>
      <button class="toggle" id="screen-reload">更新</button>
    </div>`;

  if (list.length === 0) {
    html += '<div class="empty">該当する銘柄はありません</div>';
  } else {
    html += list
      .map((i) => {
        const t = SCREEN_TIER_BY_KEY[i.tier];
        return `<div class="row" style="cursor:pointer;" data-code="${i.entry.code}">
          <div style="min-width:0; flex:1;">
            <div class="name" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
              <span style="display:inline-block; min-width:34px; text-align:center; font-size:11px; padding:1px 6px; border-radius:10px; background:${t.color}; color:#fff; margin-right:4px;">${t.label}</span>${i.entry.name}
            </div>
            <div class="code">${i.entry.code}${i.profile === "equity_lev" ? " ・ 2倍型" : ""}${i.watched ? " ・ 監視中" : ""} ・ 5日前比 ${fmtPct(i.chg5)} ・ 当日 ${fmtPct(i.chgToday)}</div>
          </div>
          <div style="text-align:right; margin-left:8px;">
            <div class="${pctClass(i.dd20)}" style="font-weight:600;">${fmtPct(i.dd20)}</div>
            <div style="font-size:10px; opacity:0.6;">20日高値比</div>
          </div>
        </div>`;
      })
      .join("");
  }

  html += `
    <div class="card" style="margin-top:16px;">
      <h3 style="margin:0 0 6px; font-size:14px;">段階の意味(過去10年・株式ETF)</h3>
      <table style="width:100%; font-size:12px; border-collapse:collapse;">
        <tr style="opacity:0.7;"><th style="text-align:left;">段階</th><th>+6%到達</th><th>63日後に利益</th><th>中央値</th></tr>
        ${SCREEN_TIERS.filter((t) => t.reach != null)
          .map(
            (t) => `<tr style="border-top:1px solid #8882;">
              <td style="padding:4px 0;"><span style="color:${t.color}; font-weight:700;">${t.label}</span><div style="font-size:10px; opacity:0.7;">${t.desc}</div></td>
              <td style="text-align:center;">${t.reach}%</td><td style="text-align:center;">${t.win}%</td>
              <td style="text-align:center;" class="${pctClass(t.med)}">${fmtPct(t.med)}</td></tr>`
          )
          .join("")}
      </table>
      <div style="font-size:10px; opacity:0.6; margin-top:6px; line-height:1.6;">
        「+6%到達」は買った日から63営業日以内に一度でも+6%を付けた割合。
        株式2倍型は別集計で、強96%・中82%・弱80%・なし69%(63日後に利益は82/76/63/60%)。値動きが大きく、保有中に一時-10%前後下げるのが普通です。
        「なし」でも利益になる割合が高いのは、この10年がおおむね上昇相場だったためです。将来の成績を保証するものではありません。
      </div>
    </div>`;

  el.className = "";
  el.innerHTML = html;

  el.querySelectorAll(".screen-tier").forEach((b) =>
    b.addEventListener("click", () => {
      const k = b.dataset.tier;
      screenFilter.tiers.has(k) ? screenFilter.tiers.delete(k) : screenFilter.tiers.add(k);
      renderScreen();
    })
  );
  document.getElementById("screen-liquid").addEventListener("change", (e) => {
    screenFilter.liquidOnly = e.target.checked;
    renderScreen();
  });
  document.getElementById("screen-watched").addEventListener("change", (e) => {
    screenFilter.watchedOnly = e.target.checked;
    renderScreen();
  });
  document.getElementById("screen-reload").addEventListener("click", () => renderScreen(true));
  el.querySelectorAll(".row[data-code]").forEach((row) => row.addEventListener("click", () => showDetail(row.dataset.code)));
}

document.querySelector('nav button[data-tab="screen"]')?.addEventListener("click", () => renderScreen());
