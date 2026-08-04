// アプリ本体(index.html/app.js)には手を加えず、この1ファイルで
// ETF詳細画面に「証券口座をお持ちでない方へ」の広告枠を追加する。
// affiliate-links.json を毎回fetchし、urlが設定されている証券会社だけ表示する。

let affiliateBrokersCache = null;

async function loadAffiliateBrokers() {
  if (affiliateBrokersCache) return affiliateBrokersCache;
  try {
    const res = await fetch("affiliate-links.json", { cache: "no-store" });
    const data = await res.json();
    affiliateBrokersCache = (data.brokers || []).filter((b) => b.url && b.url.trim() !== "");
  } catch (e) {
    affiliateBrokersCache = [];
  }
  return affiliateBrokersCache;
}

function affiliateBlockHtml(brokers) {
  if (brokers.length === 0) return "";
  const links = brokers
    .map(
      (b) =>
        `<button class="toggle affiliate-link-btn" data-url="${b.url.replace(/"/g, "&quot;")}" style="width:100%;margin-top:6px;">［PR］${b.name}で口座開設</button>`
    )
    .join("");
  return `
    <div class="detail-section affiliate-section">
      <h3>証券口座をお持ちでない方へ</h3>
      ${links}
      <div style="font-size:11px;opacity:0.55;margin-top:6px;">
        ［PR］上記はアフィリエイト広告を含みます。当サイトは投資助言を行うものではありません。
      </div>
    </div>`;
}

async function injectAffiliateBlock() {
  const container = document.getElementById("detail-content");
  if (!container) return;

  // 既存の広告枠が残っていれば一旦削除(showDetail再実行時の重複防止)
  container.querySelectorAll(".affiliate-section").forEach((el) => el.remove());

  const brokers = await loadAffiliateBrokers();
  if (brokers.length === 0) return;

  const wrap = document.createElement("div");
  wrap.innerHTML = affiliateBlockHtml(brokers);
  const section = wrap.firstElementChild;
  container.appendChild(section);

  section.querySelectorAll(".affiliate-link-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.open(btn.dataset.url, "_blank", "noopener");
    });
  });
}

// app.js の showDetail は非同期でdetail-contentを書き換える。
// 完了タイミングを正確に捉えるのが難しいため、
// detail-content の変化をMutationObserverで監視して都度広告枠を差し込む。
const detailObserverTarget = document.getElementById("detail-content");
if (detailObserverTarget) {
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    // 広告枠自身の追加/削除では再発火させない
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!document.getElementById("detail-content")?.querySelector(".affiliate-section")) {
        injectAffiliateBlock();
      }
    }, 150);
  });
  observer.observe(detailObserverTarget, { childList: true });
}
