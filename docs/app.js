document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll("main section").forEach((s) => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "dashboard") loadDashboard();
    if (btn.dataset.tab === "properties") loadProperties();
  });
});

function statusClass(status) {
  return "status status-" + (status || "").replace(/\s/g, "");
}

async function loadDashboard() {
  const cards = document.getElementById("dashboard-cards");
  const recent = document.getElementById("recent-events");
  cards.innerHTML = "読み込み中...";
  recent.innerHTML = "読み込み中...";
  const res = await callApi("dashboard");
  if (!res.ok) {
    cards.innerHTML = `<div class="msg err">取得失敗: ${res.error}</div>`;
    return;
  }
  const { inProgressProperties, recentEvents } = res.data;
  cards.innerHTML = inProgressProperties.map((p) => `
    <div class="card">
      <div>${p["物件名"]}</div>
      <div class="num"><span class="${statusClass(p["現在ステータス（自動）"])}">${p["現在ステータス（自動）"]}</span></div>
      <div style="font-size:12px;color:#888;">売主: ${p["売主氏名"] || "-"}</div>
    </div>
  `).join("") || "<div>進行中の物件はありません</div>";

  recent.innerHTML = `
    <table>
      <tr><th>物件名</th><th>買主氏名</th><th>イベント種別</th><th>日付</th><th>メモ</th></tr>
      ${recentEvents.map((e) => `
        <tr>
          <td>${e["物件名"]}</td><td>${e["買主氏名"] || "-"}</td>
          <td>${e["イベント種別"]}</td><td>${e["日付"] || ""}</td><td>${e["メモ"] || ""}</td>
        </tr>
      `).join("")}
    </table>
  `;
}

async function loadProperties() {
  const el = document.getElementById("properties-table");
  el.innerHTML = "読み込み中...";
  const res = await callApi("listProperties");
  if (!res.ok) {
    el.innerHTML = `<div class="msg err">取得失敗: ${res.error}</div>`;
    return;
  }
  el.innerHTML = `
    <table>
      <tr><th>物件名</th><th>所在地</th><th>売主氏名</th><th>担当者</th><th>現在ステータス</th><th>Drive</th></tr>
      ${res.data.map((p) => `
        <tr>
          <td>${p["物件名"]}</td>
          <td>${[p["都道府県"], p["市区町村"], p["番地"]].filter(Boolean).join(" ")}</td>
          <td>${p["売主氏名"] || "-"}</td>
          <td>${p["担当者氏名"] || "-"}</td>
          <td><span class="${statusClass(p["現在ステータス（自動）"])}">${p["現在ステータス（自動）"] || "-"}</span></td>
          <td>${p["Driveフォルダリンク"] ? `<a href="${p["Driveフォルダリンク"]}" target="_blank">開く</a>` : "-"}</td>
        </tr>
      `).join("")}
    </table>
  `;
}

async function loadDatalists() {
  const contacts = await callApi("listContacts");
  const properties = await callApi("listProperties");
  if (contacts.ok) {
    const sellers = contacts.data.filter((c) => c["種別"] === "売主");
    const buyers = contacts.data.filter((c) => c["種別"] === "買主");
    document.getElementById("contact-sellers").innerHTML = sellers.map((c) => `<option value="${c["氏名"]}">`).join("");
    document.getElementById("contact-buyers").innerHTML = buyers.map((c) => `<option value="${c["氏名"]}">`).join("");
  }
  if (properties.ok) {
    document.getElementById("property-names").innerHTML = properties.data.map((p) => `<option value="${p["物件名"]}">`).join("");
  }
}

function formToPayload(form) {
  const payload = {};
  new FormData(form).forEach((v, k) => { payload[k] = v; });
  return payload;
}

document.getElementById("form-property").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = document.getElementById("property-msg");
  msg.textContent = "登録中（Driveフォルダ作成のため数秒かかります）...";
  msg.className = "msg";
  const res = await callApi("createProperty", formToPayload(ev.target));
  if (res.ok) {
    msg.textContent = `登録しました: ${res.data.物件名}`;
    msg.className = "msg ok";
    ev.target.reset();
    loadDatalists();
  } else {
    msg.textContent = `登録失敗: ${res.error}`;
    msg.className = "msg err";
  }
});

document.getElementById("form-contact").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = document.getElementById("contact-msg");
  msg.textContent = "登録中...";
  msg.className = "msg";
  const res = await callApi("createContact", formToPayload(ev.target));
  if (res.ok) {
    msg.textContent = `登録しました: ${res.data.氏名}`;
    msg.className = "msg ok";
    ev.target.reset();
    loadDatalists();
  } else {
    msg.textContent = `登録失敗: ${res.error}`;
    msg.className = "msg err";
  }
});

document.getElementById("form-event").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = document.getElementById("event-msg");
  msg.textContent = "登録中...";
  msg.className = "msg";
  const res = await callApi("addEvent", formToPayload(ev.target));
  if (res.ok) {
    msg.textContent = "登録しました";
    msg.className = "msg ok";
    ev.target.reset();
  } else {
    msg.textContent = `登録失敗: ${res.error}`;
    msg.className = "msg err";
  }
});

loadDashboard();
loadDatalists();
