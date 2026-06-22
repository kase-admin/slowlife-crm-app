const EVENT_TYPES = [
  "問い合わせ受付", "媒介契約締結", "内覧調整", "内覧完了", "申込受付",
  "重要事項説明", "売買契約締結", "ローン本審査確認", "引渡し準備", "引渡し完了", "完了", "失注",
];

const state = {
  properties: [],
  contacts: [],
  transactions: [],
  recentEvents: [],
  activeTab: "dashboard",
};

// dirty[tab] = { key: { field: value, ... }, ... }
const dirty = { properties: {}, contacts: {}, transactions: {} };

function statusClass(status) {
  return "status status-" + (status || "").replace(/\s/g, "");
}

// ---------- タブ切り替え ----------
document.querySelectorAll("nav button, .sidebar-bottom button").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll("nav button, .sidebar-bottom button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll("main section").forEach((s) => s.classList.toggle("active", s.id === tab));

  const titles = { dashboard: "ダッシュボード", properties: "物件一覧", contacts: "顧客一覧", transactions: "取引一覧", settings: "設定" };
  document.getElementById("page-title").textContent = titles[tab] || tab;

  const isListTab = ["properties", "contacts", "transactions"].includes(tab);
  document.getElementById("btn-new").style.display = isListTab ? "" : "none";
  document.getElementById("btn-update").style.display = isListTab ? "" : "none";
  document.getElementById("fab-add").style.display = isListTab ? "" : "none";
  updateDirtyUI();

  if (tab === "settings") renderSettings();
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

  cards.innerHTML = inProgress.map((p) => `
    <div class="card">
      <div>${p["物件名"]}</div>
      <div><span class="${statusClass(p["現在ステータス（自動）"])}">${p["現在ステータス（自動）"]}</span></div>
      <div style="font-size:12px;color:var(--text-light);margin-top:4px;">売主: ${p["売主氏名"] || "-"}</div>
    </div>
  `).join("") || `<div class="empty">進行中の物件はありません</div>`;

  recent.innerHTML = `
    <table>
      <tr><th>物件名</th><th>買主氏名</th><th>イベント種別</th><th>日付</th><th>メモ</th></tr>
      ${state.recentEvents.map((e) => `
        <tr><td>${e["物件名"]}</td><td>${e["買主氏名"] || "-"}</td><td>${e["イベント種別"]}</td><td>${e["日付"] || ""}</td><td>${e["メモ"] || ""}</td></tr>
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
    <table>
      <tr><th>物件名</th><th>都道府県</th><th>市区町村</th><th>番地</th><th>価格</th><th>面積</th><th>間取り</th><th>売主氏名</th><th>現在ステータス</th><th>Drive</th></tr>
      ${rows.map((p) => {
        const key = p["物件名"];
        return `
        <tr data-key="${key}">
          <td>${key}</td>
          <td><input data-field="都道府県" value="${p["都道府県"] || ""}" /></td>
          <td><input data-field="市区町村" value="${p["市区町村"] || ""}" /></td>
          <td><input data-field="番地" value="${p["番地"] || ""}" /></td>
          <td><input data-field="価格" value="${p["価格"] || ""}" /></td>
          <td><input data-field="面積" value="${p["面積"] || ""}" /></td>
          <td><input data-field="間取り" value="${p["間取り"] || ""}" /></td>
          <td>
            <select data-field="売主氏名">
              <option value="">（未設定）</option>
              ${state.contacts.filter((c) => c["種別"] === "売主").map((c) =>
                `<option value="${c["氏名"]}" ${p["売主氏名"] === c["氏名"] ? "selected" : ""}>${c["氏名"]}</option>`
              ).join("")}
            </select>
          </td>
          <td><span class="${statusClass(p["現在ステータス（自動）"])}">${p["現在ステータス（自動）"] || "-"}</span></td>
          <td>${p["Driveフォルダリンク"] ? `<a href="${p["Driveフォルダリンク"]}" target="_blank">開く</a>` : "-"}</td>
        </tr>`;
      }).join("")}
    </table>
  `;
  bindEditableCells(el, "properties");
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
    <table>
      <tr><th>氏名</th><th>種別</th><th>メールアドレス</th><th>電話番号</th></tr>
      ${rows.map((c) => {
        const key = c["氏名"];
        return `
        <tr data-key="${key}">
          <td>${key}</td>
          <td>
            <select data-field="種別">
              ${["売主", "買主", "担当者"].map((t) => `<option value="${t}" ${c["種別"] === t ? "selected" : ""}>${t}</option>`).join("")}
            </select>
          </td>
          <td><input data-field="メールアドレス" value="${c["メールアドレス"] || ""}" /></td>
          <td><input data-field="電話番号" value="${c["電話番号"] || ""}" /></td>
        </tr>`;
      }).join("")}
    </table>
  `;
  bindEditableCells(el, "contacts");
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
    <table>
      <tr><th>物件名</th><th>買主氏名</th><th>現在ステータス</th><th>メモ</th><th>最終更新日</th></tr>
      ${rows.map((t) => {
        const key = t["物件名"] + "___" + t["買主氏名"];
        return `
        <tr data-key="${key}">
          <td>${t["物件名"]}</td>
          <td>${t["買主氏名"]}</td>
          <td>
            <select data-field="ステータス">
              ${EVENT_TYPES.map((s) => `<option value="${s}" ${t["現在ステータス"] === s ? "selected" : ""}>${s}</option>`).join("")}
            </select>
          </td>
          <td><input data-field="メモ" value="${t["メモ"] || ""}" /></td>
          <td>${t["最終更新日"] || ""}</td>
        </tr>`;
      }).join("")}
    </table>
  `;
  bindEditableCells(el, "transactions");
}

// ---------- 編集（ダーティ追跡） ----------
function bindEditableCells(container, tab) {
  container.querySelectorAll("input[data-field], select[data-field]").forEach((input) => {
    input.addEventListener("input", () => onCellChange(tab, input));
    input.addEventListener("change", () => onCellChange(tab, input));
  });
}

function onCellChange(tab, input) {
  const row = input.closest("tr");
  const key = row.dataset.key;
  const field = input.dataset.field;
  const value = input.value;

  if (!dirty[tab][key]) dirty[tab][key] = {};
  dirty[tab][key][field] = value;
  row.classList.add("row-dirty");
  updateDirtyUI();
}

function updateDirtyUI() {
  const tab = state.activeTab;
  const isListTab = ["properties", "contacts", "transactions"].includes(tab);
  const count = isListTab ? Object.keys(dirty[tab]).length : 0;
  const banner = document.getElementById("dirty-banner");
  const btn = document.getElementById("btn-update");
  if (count > 0) {
    banner.classList.remove("hidden");
    btn.disabled = false;
    btn.textContent = `更新（${count}件）`;
  } else {
    banner.classList.add("hidden");
    btn.disabled = true;
    btn.textContent = "更新";
  }
}

document.getElementById("btn-update").addEventListener("click", async () => {
  const tab = state.activeTab;
  const btn = document.getElementById("btn-update");
  btn.disabled = true;
  btn.textContent = "更新中...";

  let action, updates;
  if (tab === "properties") {
    action = "updateProperties";
    updates = Object.keys(dirty.properties).map((key) => ({ key, fields: dirty.properties[key] }));
  } else if (tab === "contacts") {
    action = "updateContacts";
    updates = Object.keys(dirty.contacts).map((key) => ({ key, fields: dirty.contacts[key] }));
  } else if (tab === "transactions") {
    action = "updateTransactions";
    updates = Object.keys(dirty.transactions).map((key) => {
      const [propertyName, buyerName] = key.split("___");
      return { 物件名: propertyName, 買主氏名: buyerName, ステータス: dirty.transactions[key]["ステータス"], メモ: dirty.transactions[key]["メモ"] };
    });
  } else {
    return;
  }

  const res = await callApi(action, { updates });
  if (res.ok) {
    dirty[tab] = {};
    await refreshAll();
  } else {
    alert("更新に失敗しました: " + res.error);
  }
  updateDirtyUI();
});

// ---------- 新規登録モーダル ----------
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

function buyerOptions() {
  return state.contacts.filter((c) => c["種別"] === "買主").map((c) => `<option value="${c["氏名"]}">`).join("");
}
function propertyOptions() {
  return state.properties.map((p) => `<option value="${p["物件名"]}">`).join("");
}

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
        <select name="売主氏名">
          <option value="">（未設定）</option>
          ${state.contacts.filter((c) => c["種別"] === "売主").map((c) => `<option value="${c["氏名"]}">${c["氏名"]}</option>`).join("")}
        </select>
      </label>
      <button type="submit">登録（Driveフォルダも自動作成）</button>
      <div id="modal-msg" class="msg"></div>
    </form>
  `);
  bindModalSubmit("createProperty", () => closeModal());
}

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
  bindModalSubmit("createContact", () => closeModal());
}

function openTransactionModal() {
  showModal("取引登録", `
    <datalist id="dl-properties">${propertyOptions()}</datalist>
    <datalist id="dl-buyers">${buyerOptions()}</datalist>
    <form id="modal-form">
      <label>物件名（必須）<input name="物件名" list="dl-properties" required /></label>
      <label>買主氏名（必須）<input name="買主氏名" list="dl-buyers" required /></label>
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
  bindModalSubmit("createTransaction", () => closeModal());
}

function bindModalSubmit(action) {
  const form = document.getElementById("modal-form");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const msg = document.getElementById("modal-msg");
    msg.textContent = "登録中...";
    msg.className = "msg";
    const payload = {};
    new FormData(form).forEach((v, k) => { payload[k] = v; });
    const res = await callApi(action, payload);
    if (res.ok) {
      msg.textContent = "登録しました";
      msg.className = "msg ok";
      await refreshAll();
      setTimeout(closeModal, 600);
    } else {
      msg.textContent = `登録失敗: ${res.error}`;
      msg.className = "msg err";
    }
  });
}

// ---------- 設定 ----------
async function renderSettings() {
  document.getElementById("settings-api-base").textContent = window.CRM_CONFIG.API_BASE;
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

switchTab("dashboard");
refreshAll();
