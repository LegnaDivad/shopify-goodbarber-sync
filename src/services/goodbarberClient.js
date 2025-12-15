const { goodbarberConfig } = require('../config/goodbarber');

async function gbRequest(path, { method = 'GET', body, headers = {} } = {}) {
  const url = new URL(path, goodbarberConfig.baseUrl);

  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      [goodbarberConfig.tokenHeader]: goodbarberConfig.token,
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    const err = new Error(`GoodBarber API error ${res.status} ${res.statusText}`);
    err.status = res.status;
    err.payload = data;
    throw err;
  }

  return data;
}

module.exports = { gbRequest };
