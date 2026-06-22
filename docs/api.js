async function callApi(action, payload) {
  const { API_BASE, API_TOKEN } = window.CRM_CONFIG;

  if (payload) {
    // GASのWeb Appはconfidentialではないため、簡易的にPOSTで送る（JSONボディ）
    const res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, token: API_TOKEN, payload }),
    });
    return res.json();
  }

  const url = `${API_BASE}?action=${encodeURIComponent(action)}&token=${encodeURIComponent(API_TOKEN)}`;
  const res = await fetch(url);
  return res.json();
}
