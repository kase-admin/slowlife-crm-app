const EVENT_TYPES = [
  "問い合わせ受付", "媒介契約締結", "内覧調整", "内覧完了", "申込受付",
  "重要事項説明", "売買契約締結", "ローン本審査確認", "引渡し準備", "引渡し完了", "完了", "失注",
];

// 物件のみで発行できる書類（売主情報があれば発行可能）
const PROPERTY_DOC_TYPES = ["物件概要書", "媒介契約書"];
// 取引（物件×買主）が必要な書類
const TRANSACTION_DOC_TYPES = ["重要事項説明書", "売買契約書"];

// 取引の現在ステータスに応じて、次に発行すべき書類を絞り込むための対応表。
// 該当が無いステータスでは TRANSACTION_DOC_TYPES 全体を候補として表示する。
const STATUS_TO_DOC_TYPES = {
  "問い合わせ受付": ["重要事項説明書"],
  "媒介契約締結": ["重要事項説明書"],
  "内覧調整": ["重要事項説明書"],
  "内覧完了": ["重要事項説明書"],
  "申込受付": ["重要事項説明書"],
  "重要事項説明": ["売買契約書"],
  "売買契約締結": ["売買契約書"],
  "ローン本審査確認": ["売買契約書"],
  "引渡し準備": ["売買契約書"],
  "引渡し完了": ["売買契約書"],
};

// 取引完了までの標準的な進行順（ダッシュボードの進捗バー用）。「失注」は別扱い。
const FUNNEL_STAGES = [
  "問い合わせ受付", "媒介契約締結", "内覧調整", "内覧完了", "申込受付",
  "重要事項説明", "売買契約締結", "ローン本審査確認", "引渡し準備", "引渡し完了", "完了",
];

const state = {
  properties: [],
  contacts: [],
  transactions: [],
  recentEvents: [],
  activeTab: "dashboard",
};

function statusClass(status) {
  return "status status-" + (status || "").replace(/\s/g, "");
}

function progressPercent(status) {
  if (status === "失注") return { percent: 100, lost: true };
  const idx = FUNNEL_STAGES.indexOf(status);
  if (idx === -1) return { percent: 0, lost: false };
  return { percent: Math.round(((idx + 1) / FUNNEL_STAGES.length) * 100), lost: false };
}

// ---------- タブ切り替え ----------
document.querySelectorAll("nav button, .sidebar-bottom button").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll("nav button, .sidebar-bottom button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("main section").forEach((s) => s.classList.toggle("active", s.id === tab));

  const titles = { dashboard: "ダッシュボード", properties: "物件一覧", contacts: "顧客一覧", transactions: "取引一覧", documents: "書類発行", settings: "設定" };
  document.getElementById("page-title").textContent = titles[tab] || tab;

  const isListTab = ["properties", "contacts", "transactions"].includes(tab);
  document.getElementById("btn-new").style.display = isListTab ? "" : "none";
  document.getElementById("fab-add").style.display = isListTab ? "" : "none";

  if (tab === "settings") renderSettings();
  if (tab === "documents") renderDocumentsPage();
}

// ---------- 初期ロード（1回のbootstrap呼び出しでまとめて取得） ----------
async function refreshAll() {
  const res = await callApi("bootstrap");
  if (!res.ok) {
    document.getElementById("dashboard-cards").innerHTML = `<div class="msg err">読み込み失敗: ${res.error}</div>`;
    return;
  }
  state.properties = res.data.properties;
  state.contacts = res.data.contacts;
  state.transactions = res.data.transactions;
  state.recentEvents = res.data.recentEvents;

  renderDashboard();
  populatePropertyFilterOptions();
  populateContactFilterOptions();
  populateTransactionFilterOptions();
  renderPropertiesTable();
  renderContactsTable();
  renderTransactionsTable();
}

// ---------- ダッシュボード ----------
function renderDashboard() {
  const cards = document.getElementById("dashboard-cards");
  const recent = document.getElementById("recent-events");
  const inProgress = state.properties.filter((p) => p["現在ステータス（自動）"] && p["現在ステータス（自動）"] !== "完了");

  cards.innerHTML = inProgress.map((p) => {
    const status = p["現在ステータス（自動）"];
    const { percent, lost } = progressPercent(status);
    return `
    <div class="card">
      <div>${p["物件名"]}</div>
      <div><span class="${statusClass(status)}">${status}</span></div>
      <div class="progress-track"><div class="progress-fill ${lost ? "lost" : ""}" style="width:${percent}%"></div></div>
      <div class="progress-label">${lost ? "失注" : `取引完了まで ${percent}%`}</div>
      <div style="font-size:12px;color:var(--text-light);margin-top:6px;">売主: ${p["売主氏名"] || "-"}</div>
    </div>
  `;
  }).join("") || `<div class="empty">進行中の物件はありません</div>`;

  recent.innerHTML = `
    <table>
      <tr><th>物件名</th><th>買主氏名</th><th>イベント種別</th><th>日付</th><th>メモ</th></tr>
      ${state.recentEvents.map((e) => `
        <tr><td>${e["物件名"] || "-"}</td><td>${e["買主氏名"] || "-"}</td><td>${e["イベント種別"]}</td><td>${e["日付"] || ""}</td><td>${e["メモ"] || ""}</td></tr>
      `).join("")}
    </table>
  `;
}

// ---------- 物件一覧 ----------
function populatePropertyFilterOptions() {
  const statuses = [...new Set(state.properties.map((p) => p["現在ステータス（自動）"]).filter(Boolean))];
  const prefs = [...new Set(state.properties.map((p) => p["都道府県"]).filter(Boolean))];
  document.getElementById("filter-property-status").innerHTML = `<option value="">ステータス: すべて</option>` + statuses.map((s) => `<option value="${s}">${s}</option>`).join("");
  document.getElementById("filter-property-pref").innerHTML = `<option value="">都道府県: すべて</option>` + prefs.map((p) => `<option value="${p}">${p}</option>`).join("");
}

function filteredProperties() {
  const kw = document.getElementById("filter-property-keyword").value.trim();
  const status = document.getElementById("filter-property-status").value;
  const pref = document.getElementById("filter-property-pref").value;
  return state.properties.filter((p) => {
    if (status && p["現在ステータス（自動）"] !== status) return false;
    if (pref && p["都道府県"] !== pref) return false;
    if (kw) {
      const hay = [p["物件名"], p["都道府県"], p["市区町村"], p["番地"], p["売主氏名"]].join(" ");
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function renderPropertiesTable() {
  const el = document.getElementById("properties-table");
  const rows = filteredProperties();
  if (rows.length === 0) { el.innerHTML = `<div class="empty">該当する物件がありません</div>`; return; }

  el.innerHTML = `
    <div class="table-scroll"><table>
      <tr><th>物件</th><th>価格</th><th>面積/間取り</th><th>売主氏名</th><th>現在ステータス</th><th>Drive</th><th>操作</th></tr>
      ${rows.map((p) => {
        const key = p["物件名"];
        const address = [p["都道府県"], p["市区町村"], p["番地"]].filter(Boolean).join(" ");
        return `
        <tr data-key="${key}">
          <td>
            <div class="property-name">${key}</div>
            <div class="property-address">${address || "-"}</div>
          </td>
          <td>${p["価格"] || "-"}</td>
          <td>${[p["面積"], p["間取り"]].filter(Boolean).join(" / ") || "-"}</td>
          <td>${p["売主氏名"] || "-"}</td>
          <td><span class="${statusClass(p["現在ステータス（自動）"])}">${p["現在ステータス（自動）"] || "-"}</span></td>
          <td>${p["Driveフォルダリンク"] ? `<a href="${p["Driveフォルダリンク"]}" target="_blank">開く</a>` : "-"}</td>
          <td>
            <div class="row-actions">
              <button class="btn-row-action btn-row-edit" data-property="${key}">編集</button>
              <button class="btn-row-action btn-row-delete" data-property="${key}">削除</button>
            </div>
          </td>
        </tr>`;
      }).join("")}
    </table></div>
  `;
  el.querySelectorAll(".btn-row-edit").forEach((btn) => {
    btn.addEventListener("click", () => openPropertyEditModal(btn.dataset.property));
  });
  el.querySelectorAll(".btn-row-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteProperty(btn.dataset.property));
  });
}

async function deleteProperty(propertyName) {
  const confirmed = confirm(
    `物件「${propertyName}」を削除します。\nGoogle Drive上の物件フォルダ（書類含む）も完全に削除されます。\n本当に削除しますか？`
  );
  if (!confirmed) return;

  const res = await callApi("deleteProperty", { 物件名: propertyName });
  if (res.ok) {
    await refreshAll();
  } else {
    alert("削除に失敗しました: " + res.error);
  }
}

// ---------- 顧客一覧 ----------
function populateContactFilterOptions() {
  const types = [...new Set(state.contacts.map((c) => c["種別"]).filter(Boolean))];
  document.getElementById("filter-contact-type").innerHTML = `<option value="">種別: すべて</option>` + types.map((t) => `<option value="${t}">${t}</option>`).join("");
}

function filteredContacts() {
  const kw = document.getElementById("filter-contact-keyword").value.trim();
  const type = document.getElementById("filter-contact-type").value;
  return state.contacts.filter((c) => {
    if (type && c["種別"] !== type) return false;
    if (kw) {
      const hay = [c["氏名"], c["メールアドレス"], c["電話番号"]].join(" ");
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function renderContactsTable() {
  const el = document.getElementById("contacts-table");
  const rows = filteredContacts();
  if (rows.length === 0) { el.innerHTML = `<div class="empty">該当する顧客がありません</div>`; return; }

  el.innerHTML = `
    <div class="table-scroll"><table>
      <tr><th>氏名</th><th>種別</th><th>メールアドレス</th><th>電話番号</th><th>操作</th></tr>
      ${rows.map((c) => {
        const key = c["氏名"];
        return `
        <tr data-key="${key}">
          <td>${key}</td>
          <td>${c["種別"] || "-"}</td>
          <td>${c["メールアドレス"] || "-"}</td>
          <td>${c["電話番号"] || "-"}</td>
          <td>
            <div class="row-actions">
              <button class="btn-row-action btn-row-edit" data-contact="${key}">編集</button>
              <button class="btn-row-action btn-row-delete" data-contact="${key}">削除</button>
            </div>
          </td>
        </tr>`;
      }).join("")}
    </table></div>
  `;
  el.querySelectorAll(".btn-row-edit").forEach((btn) => {
    btn.addEventListener("click", () => openContactEditModal(btn.dataset.contact));
  });
  el.querySelectorAll(".btn-row-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteContact(btn.dataset.contact));
  });
}

async function deleteContact(name) {
  const confirmed = confirm(`顧客「${name}」を削除します。\n本当に削除しますか？`);
  if (!confirmed) return;
  const res = await callApi("deleteContact", { 氏名: name });
  if (res.ok) {
    await refreshAll();
  } else {
    alert("削除に失敗しました: " + res.error);
  }
}

// ---------- 取引一覧 ----------
function populateTransactionFilterOptions() {
  const statuses = [...new Set(state.transactions.map((t) => t["現在ステータス"]).filter(Boolean))];
  document.getElementById("filter-tx-status").innerHTML = `<option value="">ステータス: すべて</option>` + statuses.map((s) => `<option value="${s}">${s}</option>`).join("");
}

function filteredTransactions() {
  const kw = document.getElementById("filter-tx-keyword").value.trim();
  const status = document.getElementById("filter-tx-status").value;
  return state.transactions.filter((t) => {
    if (status && t["現在ステータス"] !== status) return false;
    if (kw) {
      const hay = [t["物件名"], t["買主氏名"]].join(" ");
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}

function renderTransactionsTable() {
  const el = document.getElementById("transactions-table");
  const rows = filteredTransactions();
  if (rows.length === 0) { el.innerHTML = `<div class="empty">該当する取引がありません</div>`; return; }

  el.innerHTML = `
    <div class="table-scroll"><table>
      <tr><th>物件名</th><th>買主氏名</th><th>現在ステータス</th><th>メモ</th><th>最終更新日</th><th>操作</th></tr>
      ${rows.map((t) => `
        <tr data-key="${t["物件名"]}___${t["買主氏名"]}">
          <td>${t["物件名"]}</td>
          <td>${t["買主氏名"]}</td>
          <td><span class="${statusClass(t["現在ステータス"])}">${t["現在ステータス"]}</span></td>
          <td>${t["メモ"] || "-"}</td>
          <td>${t["最終更新日"] || ""}</td>
          <td>
            <div class="row-actions">
              <button class="btn-row-action btn-row-edit" data-property="${t["物件名"]}" data-buyer="${t["買主氏名"]}">編集</button>
              <button class="btn-row-action btn-row-delete" data-property="${t["物件名"]}" data-buyer="${t["買主氏名"]}">削除</button>
            </div>
          </td>
        </tr>
      `).join("")}
    </table></div>
  `;
  el.querySelectorAll(".btn-row-edit").forEach((btn) => {
    btn.addEventListener("click", () => openTransactionEditModal(btn.dataset.property, btn.dataset.buyer));
  });
  el.querySelectorAll(".btn-row-delete").forEach((btn) => {
    btn.addEventListener("click", () => deleteTransaction(btn.dataset.property, btn.dataset.buyer));
  });
}

async function deleteTransaction(propertyName, buyerName) {
  const confirmed = confirm(`取引「${propertyName} × ${buyerName}」を削除します。\n履歴も含めて完全に削除されます。本当に削除しますか？`);
  if (!confirmed) return;
  const res = await callApi("deleteTransaction", { 物件名: propertyName, 買主氏名: buyerName });
  if (res.ok) {
    await refreshAll();
  } else {
    alert("削除に失敗しました: " + res.error);
  }
}

// ---------- 書類発行ページ ----------
function renderDocumentsPage() {
  const propertySelect = document.getElementById("doc-property-select");
  propertySelect.innerHTML = state.properties.map((p) => `<option value="${p["物件名"]}">${p["物件名"]}</option>`).join("");

  propertySelect.onchange = updateTransactionSelectForDocuments;
  document.getElementById("doc-transaction-select").onchange = updateDocTypeOptionsForDocuments;

  updateTransactionSelectForDocuments();
}

function updateTransactionSelectForDocuments() {
  const propertyName = document.getElementById("doc-property-select").value;
  const txSelect = document.getElementById("doc-transaction-select");
  const txForProperty = state.transactions.filter((t) => t["物件名"] === propertyName);

  txSelect.innerHTML = `<option value="">（物件のみ・買主未確定）</option>` +
    txForProperty.map((t) => `<option value="${t["買主氏名"]}">${t["買主氏名"]}（現在: ${t["現在ステータス"]}）</option>`).join("");

  updateDocTypeOptionsForDocuments();
}

function updateDocTypeOptionsForDocuments() {
  const propertyName = document.getElementById("doc-property-select").value;
  const buyerName = document.getElementById("doc-transaction-select").value;
  const typeSelect = document.getElementById("doc-type-select");
  const hint = document.getElementById("doc-status-hint");

  if (!buyerName) {
    typeSelect.innerHTML = PROPERTY_DOC_TYPES.map((t) => `<option value="${t}">${t}</option>`).join("");
    hint.textContent = "物件のみの書類（物件概要書・媒介契約書）を発行できます。";
    return;
  }

  const tx = state.transactions.find((t) => t["物件名"] === propertyName && t["買主氏名"] === buyerName);
  const status = tx ? tx["現在ステータス"] : "";
  const recommended = STATUS_TO_DOC_TYPES[status] || TRANSACTION_DOC_TYPES;

  typeSelect.innerHTML = recommended.map((t) => `<option value="${t}">${t}</option>`).join("");
  hint.textContent = `現在の取引ステータス「${status}」に応じて、発行可能な書類を絞り込んでいます。`;
}

document.getElementById("btn-issue-document").addEventListener("click", async () => {
  const propertyName = document.getElementById("doc-property-select").value;
  const buyerName = document.getElementById("doc-transaction-select").value;
  const docType = document.getElementById("doc-type-select").value;
  const msg = document.getElementById("doc-issue-msg");
  const btn = document.getElementById("btn-issue-document");

  if (!propertyName || !docType) {
    msg.textContent = "物件と書類の種類を選択してください";
    msg.className = "msg err";
    return;
  }

  btn.disabled = true;
  msg.textContent = "発行中...";
  msg.className = "msg";

  const payload = { 物件名: propertyName, docType };
  if (buyerName) payload["買主氏名"] = buyerName;

  const res = await callApi("generateDocument", payload);
  btn.disabled = false;

  if (res.ok) {
    msg.textContent = "発行しました。新しいタブで開きます。";
    msg.className = "msg ok";
    window.open(res.data.url, "_blank");
  } else {
    msg.textContent = "発行に失敗しました: " + res.error;
    msg.className = "msg err";
  }
});

// ---------- モーダル共通処理 ----------
const modalOverlay = document.getElementById("modal-overlay");
const modalBody = document.getElementById("modal-body");
const modalTitle = document.getElementById("modal-title");

function openModal() {
  const tab = state.activeTab;
  if (tab === "properties") openPropertyModal();
  else if (tab === "contacts") openContactModal();
  else if (tab === "transactions") openTransactionModal();
}

document.getElementById("btn-new").addEventListener("click", openModal);
document.getElementById("fab-add").addEventListener("click", openModal);
document.getElementById("modal-close").addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });

function closeModal() { modalOverlay.classList.add("hidden"); }
function showModal(title, bodyHtml) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalOverlay.classList.remove("hidden");
}

/** select(id=selectId)の値が "__new__" の時だけ fieldsId の領域を表示する */
function bindNestedToggle(selectId, fieldsId) {
  const sel = document.getElementById(selectId);
  const fields = document.getElementById(fieldsId);
  sel.addEventListener("change", () => {
    fields.classList.toggle("hidden", sel.value !== "__new__");
  });
}

function bindModalSubmit(action, options) {
  options = options || {};
  const form = document.getElementById("modal-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = document.getElementById("modal-msg");
    msg.textContent = (options.submitLabel || "登録") + "中...";
    msg.className = "msg";
    const raw = {};
    new FormData(form).forEach((v, k) => { raw[k] = v; });
    const payload = options.buildPayload ? options.buildPayload(raw) : raw;
    const res = await callApi(action, payload);
    if (res.ok) {
      msg.textContent = (options.submitLabel || "登録") + "しました";
      msg.className = "msg ok";
      await refreshAll();
      setTimeout(closeModal, 600);
    } else {
      msg.textContent = `失敗: ${res.error}`;
      msg.className = "msg err";
    }
  });
}

// ---------- 物件登録（新規）----------
function openPropertyModal() {
  showModal("物件登録", `
    <form id="modal-form">
      <label>物件名（必須）<input name="物件名" required /></label>
      <label>都道府県<input name="都道府県" /></label>
      <label>市区町村<input name="市区町村" /></label>
      <label>番地<input name="番地" /></label>
      <label>価格<input name="価格" /></label>
      <label>面積<input name="面積" /></label>
      <label>間取り<input name="間取り" /></label>
      <label>売主氏名
        <select id="seller-select">
          <option value="">（未設定）</option>
          ${state.contacts.filter((c) => c["種別"] === "売主").map((c) => `<option value="${c["氏名"]}">${c["氏名"]}</option>`).join("")}
          <option value="__new__">＋ 新規売主を登録</option>
        </select>
      </label>
      <div id="new-seller-fields" class="nested-fields hidden">
        <label>新規売主氏名（必須）<input id="new-seller-name" /></label>
        <label>メールアドレス<input id="new-seller-email" type="email" /></label>
        <label>電話番号<input id="new-seller-phone" /></label>
      </div>
      <button type="submit">登録（Driveフォルダも自動作成）</button>
      <div id="modal-msg" class="msg"></div>
    </form>
  `);
  bindNestedToggle("seller-select", "new-seller-fields");
  bindPropertyCreateSubmit();
}

function bindPropertyCreateSubmit() {
  const form = document.getElementById("modal-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = document.getElementById("modal-msg");
    msg.textContent = "登録中...";
    msg.className = "msg";

    let sellerName = document.getElementById("seller-select").value;
    if (sellerName === "__new__") {
      sellerName = document.getElementById("new-seller-name").value.trim();
      if (!sellerName) {
        msg.textContent = "新規売主の氏名を入力してください";
        msg.className = "msg err";
        return;
      }
      const contactRes = await callApi("createContact", {
        氏名: sellerName,
        種別: "売主",
        メールアドレス: document.getElementById("new-seller-email").value,
        電話番号: document.getElementById("new-seller-phone").value,
      });
      if (!contactRes.ok) {
        msg.textContent = "売主の登録に失敗しました: " + contactRes.error;
        msg.className = "msg err";
        return;
      }
    }

    const raw = {};
    new FormData(form).forEach((v, k) => { raw[k] = v; });
    raw["売主氏名"] = sellerName;

    const res = await callApi("createProperty", raw);
    if (res.ok) {
      msg.textContent = "登録しました";
      msg.className = "msg ok";
      await refreshAll();
      setTimeout(closeModal, 600);
    } else {
      msg.textContent = "登録に失敗しました: " + res.error;
      msg.className = "msg err";
    }
  });
}

// ---------- 物件編集 ----------
function openPropertyEditModal(propertyName) {
  const p = state.properties.find((x) => x["物件名"] === propertyName);
  if (!p) return;
  showModal(`物件を編集: ${propertyName}`, `
    <form id="modal-form">
      <label>都道府県<input name="都道府県" value="${p["都道府県"] || ""}" /></label>
      <label>市区町村<input name="市区町村" value="${p["市区町村"] || ""}" /></label>
      <label>番地<input name="番地" value="${p["番地"] || ""}" /></label>
      <label>価格<input name="価格" value="${p["価格"] || ""}" /></label>
      <label>面積<input name="面積" value="${p["面積"] || ""}" /></label>
      <label>間取り<input name="間取り" value="${p["間取り"] || ""}" /></label>
      <label>売主氏名
        <select name="売主氏名">
          <option value="">（未設定）</option>
          ${state.contacts.filter((c) => c["種別"] === "売主").map((c) =>
            `<option value="${c["氏名"]}" ${p["売主氏名"] === c["氏名"] ? "selected" : ""}>${c["氏名"]}</option>`
          ).join("")}
        </select>
      </label>
      <button type="submit">保存</button>
      <div id="modal-msg" class="msg"></div>
    </form>
  `);
  bindModalSubmit("updateProperties", {
    submitLabel: "保存",
    buildPayload: (fields) => ({ updates: [{ key: propertyName, fields }] }),
  });
}

// ---------- 顧客登録（新規）----------
function openContactModal() {
  showModal("顧客登録", `
    <form id="modal-form">
      <label>氏名（必須）<input name="氏名" required /></label>
      <label>種別
        <select name="種別">
          <option value="売主">売主</option>
          <option value="買主">買主</option>
          <option value="担当者">担当者</option>
        </select>
      </label>
      <label>メールアドレス<input name="メールアドレス" type="email" /></label>
      <label>電話番号<input name="電話番号" /></label>
      <button type="submit">登録</button>
      <div id="modal-msg" class="msg"></div>
    </form>
  `);
  bindModalSubmit("createContact");
}

// ---------- 顧客編集 ----------
function openContactEditModal(name) {
  const c = state.contacts.find((x) => x["氏名"] === name);
  if (!c) return;
  showModal(`顧客を編集: ${name}`, `
    <form id="modal-form">
      <label>種別
        <select name="種別">
          ${["売主", "買主", "担当者"].map((t) => `<option value="${t}" ${c["種別"] === t ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </label>
      <label>メールアドレス<input name="メールアドレス" value="${c["メールアドレス"] || ""}" /></label>
      <label>電話番号<input name="電話番号" value="${c["電話番号"] || ""}" /></label>
      <button type="submit">保存</button>
      <div id="modal-msg" class="msg"></div>
    </form>
  `);
  bindModalSubmit("updateContacts", {
    submitLabel: "保存",
    buildPayload: (fields) => ({ updates: [{ key: name, fields }] }),
  });
}

// ---------- 取引登録（新規。物件・買主が無ければその場で新規登録できる）----------
function openTransactionModal() {
  showModal("取引登録", `
    <form id="modal-form">
      <label>物件名（必須）
        <select id="tx-property-select">
          <option value="">選択してください</option>
          ${state.properties.map((p) => `<option value="${p["物件名"]}">${p["物件名"]}</option>`).join("")}
          <option value="__new__">＋ 新規物件を登録</option>
        </select>
      </label>
      <div id="new-property-fields" class="nested-fields hidden">
        <label>新規物件名（必須）<input id="new-property-name" /></label>
        <label>都道府県<input id="new-property-pref" /></label>
        <label>市区町村<input id="new-property-city" /></label>
        <label>番地<input id="new-property-addr" /></label>
      </div>

      <label>買主氏名（必須）
        <select id="tx-buyer-select">
          <option value="">選択してください</option>
          ${state.contacts.filter((c) => c["種別"] === "買主").map((c) => `<option value="${c["氏名"]}">${c["氏名"]}</option>`).join("")}
          <option value="__new__">＋ 新規買主を登録</option>
        </select>
      </label>
      <div id="new-buyer-fields" class="nested-fields hidden">
        <label>新規買主氏名（必須）<input id="new-buyer-name" /></label>
        <label>メールアドレス<input id="new-buyer-email" type="email" /></label>
        <label>電話番号<input id="new-buyer-phone" /></label>
      </div>

      <label>ステータス（必須）
        <select name="イベント種別" required>
          ${EVENT_TYPES.map((s) => `<option value="${s}">${s}</option>`).join("")}
        </select>
      </label>
      <label>日付（必須）<input name="日付" type="date" required value="${new Date().toISOString().slice(0, 10)}" /></label>
      <label>メモ<input name="メモ" /></label>
      <button type="submit">登録</button>
      <div id="modal-msg" class="msg"></div>
    </form>
  `);
  bindNestedToggle("tx-property-select", "new-property-fields");
  bindNestedToggle("tx-buyer-select", "new-buyer-fields");
  bindTransactionCreateSubmit();
}

function bindTransactionCreateSubmit() {
  const form = document.getElementById("modal-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = document.getElementById("modal-msg");
    msg.textContent = "登録中...";
    msg.className = "msg";

    let propertyName = document.getElementById("tx-property-select").value;
    if (propertyName === "__new__") {
      propertyName = document.getElementById("new-property-name").value.trim();
      if (!propertyName) {
        msg.textContent = "新規物件名を入力してください";
        msg.className = "msg err";
        return;
      }
      const pRes = await callApi("createProperty", {
        物件名: propertyName,
        都道府県: document.getElementById("new-property-pref").value,
        市区町村: document.getElementById("new-property-city").value,
        番地: document.getElementById("new-property-addr").value,
      });
      if (!pRes.ok) {
        msg.textContent = "物件の登録に失敗しました: " + pRes.error;
        msg.className = "msg err";
        return;
      }
    } else if (!propertyName) {
      msg.textContent = "物件を選択してください";
      msg.className = "msg err";
      return;
    }

    let buyerName = document.getElementById("tx-buyer-select").value;
    if (buyerName === "__new__") {
      buyerName = document.getElementById("new-buyer-name").value.trim();
      if (!buyerName) {
        msg.textContent = "新規買主の氏名を入力してください";
        msg.className = "msg err";
        return;
      }
      const cRes = await callApi("createContact", {
        氏名: buyerName,
        種別: "買主",
        メールアドレス: document.getElementById("new-buyer-email").value,
        電話番号: document.getElementById("new-buyer-phone").value,
      });
      if (!cRes.ok) {
        msg.textContent = "買主の登録に失敗しました: " + cRes.error;
        msg.className = "msg err";
        return;
      }
    } else if (!buyerName) {
      msg.textContent = "買主を選択してください";
      msg.className = "msg err";
      return;
    }

    const raw = {};
    new FormData(form).forEach((v, k) => { raw[k] = v; });
    raw["物件名"] = propertyName;
    raw["買主氏名"] = buyerName;

    const res = await callApi("createTransaction", raw);
    if (res.ok) {
      msg.textContent = "登録しました";
      msg.className = "msg ok";
      await refreshAll();
      setTimeout(closeModal, 600);
    } else {
      msg.textContent = "登録に失敗しました: " + res.error;
      msg.className = "msg err";
    }
  });
}

// ---------- 取引編集 ----------
function openTransactionEditModal(propertyName, buyerName) {
  const t = state.transactions.find((x) => x["物件名"] === propertyName && x["買主氏名"] === buyerName);
  if (!t) return;
  showModal(`取引を編集: ${propertyName} × ${buyerName}`, `
    <form id="modal-form">
      <label>ステータス
        <select name="ステータス">
          ${EVENT_TYPES.map((s) => `<option value="${s}" ${t["現在ステータス"] === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </label>
      <label>メモ<input name="メモ" value="${t["メモ"] || ""}" /></label>
      <button type="submit">保存</button>
      <div id="modal-msg" class="msg"></div>
    </form>
  `);
  bindModalSubmit("updateTransactions", {
    submitLabel: "保存",
    buildPayload: (fields) => ({
      updates: [{ 物件名: propertyName, 買主氏名: buyerName, ステータス: fields["ステータス"], メモ: fields["メモ"] }],
    }),
  });
}

// ---------- 設定 ----------
async function renderSettings() {
  document.getElementById("settings-api-base").textContent = window.CRM_CONFIG.API_BASE;
  document.getElementById("settings-user-email").textContent = document.getElementById("user-info").textContent;
  const statusEl = document.getElementById("settings-ss-status");
  statusEl.textContent = "確認中...";
  const res = await callApi("listProperties");
  statusEl.textContent = res.ok ? `接続OK（物件${res.data.length}件）` : `接続エラー: ${res.error}`;
}

document.getElementById("btn-clear-cache").addEventListener("click", async () => {
  const res = await callApi("clearCache");
  alert(res.ok ? "キャッシュをクリアしました" : "失敗: " + res.error);
});

// ---------- フィルター監視 ----------
["filter-property-keyword", "filter-property-status", "filter-property-pref"].forEach((id) =>
  document.getElementById(id).addEventListener("input", renderPropertiesTable));
["filter-contact-keyword", "filter-contact-type"].forEach((id) =>
  document.getElementById(id).addEventListener("input", renderContactsTable));
["filter-tx-keyword", "filter-tx-status"].forEach((id) =>
  document.getElementById(id).addEventListener("input", renderTransactionsTable));

// ログイン成功後（auth.js の onAuthSuccess から）に呼び出される
function startApp() {
  switchTab("dashboard");
  refreshAll();
}
