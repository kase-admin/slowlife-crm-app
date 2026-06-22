// 現在ログイン中のGoogle IDトークン。auth.js の setIdToken() で更新される。
let CURRENT_ID_TOKEN = null;

function setIdToken(token) {
  CURRENT_ID_TOKEN = token;
}

async function callApi(action, payload) {
  const { API_BASE } = window.CRM_CONFIG;
  const body = { action, idToken: CURRENT_ID_TOKEN };
  if (payload) body.payload = payload;

  const res = await fetch(API_BASE, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
  });
  return res.json();
}
