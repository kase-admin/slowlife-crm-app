// Googleログイン（Identity Services）を使ったアクセス制御。
// GitHub Pages自体は誰でも閲覧できる静的サイトのため、ここでのログインは
// 「画面を使えるようにする」ためのゲートであり、実際の権限チェックはGAS側で
// IDトークンをAuthシートの許可リストと照合して行っている（フロントエンドだけでは
// なりすましを防げないため、サーバー側の検証が必須）。

const SESSION_STORAGE_KEY = "crm_id_token";

function showLoginOverlay() {
  document.getElementById("login-overlay").classList.remove("hidden");
}

function hideLoginOverlay() {
  document.getElementById("login-overlay").classList.add("hidden");
}

async function handleCredentialResponse(response) {
  const idToken = response.credential;
  setIdToken(idToken);

  const msg = document.getElementById("login-msg");
  msg.textContent = "確認中...";
  msg.className = "msg";

  const res = await callApi("whoAmI");
  if (res.ok) {
    sessionStorage.setItem(SESSION_STORAGE_KEY, idToken);
    onAuthSuccess(res.data.email, res.data.name);
  } else {
    setIdToken(null);
    msg.textContent = res.error || "ログインできませんでした";
    msg.className = "msg err";
  }
}

function onAuthSuccess(email, name) {
  document.getElementById("login-msg").textContent = "";
  document.getElementById("user-info").textContent = name || email;
  hideLoginOverlay();
  startApp();
}

function logout() {
  setIdToken(null);
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
  document.getElementById("user-info").textContent = "";
  if (window.google && google.accounts && google.accounts.id) {
    google.accounts.id.disableAutoSelect();
  }
  showLoginOverlay();
}

async function tryRestoreSession() {
  const savedToken = sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!savedToken) return;
  setIdToken(savedToken);
  const res = await callApi("whoAmI");
  if (res.ok) {
    onAuthSuccess(res.data.email, res.data.name);
  } else {
    setIdToken(null);
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

function initGoogleSignIn() {
  google.accounts.id.initialize({
    client_id: window.CRM_CONFIG.GOOGLE_CLIENT_ID,
    callback: handleCredentialResponse,
  });
  google.accounts.id.renderButton(
    document.getElementById("g_id_button_container"),
    { theme: "outline", size: "large", text: "signin_with", locale: "ja" }
  );

  tryRestoreSession();
}

document.getElementById("btn-logout").addEventListener("click", logout);

window.addEventListener("load", initGoogleSignIn);
