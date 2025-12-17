const express = require('express');
const { pool } = require('../config/db');
const { isValidShopDomain, verifyShopifyQueryHmac, newState } = require('../utils/shopifyOAuthVerify');
const { resolveShopDomain } = require('../services/shopifyShopResolver');


const router = express.Router();

function requiredEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

// (Opcional) Status para verificar env vars sin exponer secretos
router.get('/shopify/status', (req, res) => {
  res.json({
    ok: true,
    baseUrl: process.env.APP_BASE_URL || null,
    redirectUri: process.env.SHOPIFY_REDIRECT_URI || null,
    scopes: process.env.SHOPIFY_SCOPES || null,
    hasClientId: Boolean(process.env.SHOPIFY_CLIENT_ID),
    hasClientSecret: Boolean(process.env.SHOPIFY_CLIENT_SECRET),
  });
});

// Entrada (Shopify te manda aquí desde el install link / app URL)
router.get('/shopify/launch', async (req, res) => {
  const clientId = requiredEnv('SHOPIFY_CLIENT_ID');
  const clientSecret = requiredEnv('SHOPIFY_CLIENT_SECRET');
  const scopes = requiredEnv('SHOPIFY_SCOPES');
  const redirectUri = requiredEnv('SHOPIFY_REDIRECT_URI');

  const shop = req.query.shop;

  if (!isValidShopDomain(shop)) return res.status(400).send('Invalid shop domain');
  if (!verifyShopifyQueryHmac(req.query, clientSecret)) return res.status(401).send('Invalid HMAC');

  const state = newState();
  await pool.query(
    `insert into public.shopify_oauth_state (state, shop_domain) values ($1, $2)`,
    [state, shop]
  );

  const authUrl =
    `https://${shop}/admin/oauth/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}`;

  return res.redirect(authUrl);
});

// Callback (Shopify devuelve code + state aquí)
router.get('/shopify/callback', async (req, res) => {
  const clientId = requiredEnv('SHOPIFY_CLIENT_ID');
  const clientSecret = requiredEnv('SHOPIFY_CLIENT_SECRET');

  const shop = req.query.shop;
  const code = req.query.code;
  const state = req.query.state;

  if (!isValidShopDomain(shop)) return res.status(400).send('Invalid shop domain');
  if (!code || !state) return res.status(400).send('Missing code/state');

  // Verificación HMAC del callback
  if (!verifyShopifyQueryHmac(req.query, clientSecret)) {
    return res.status(401).send('Invalid HMAC');
  }

  // Validar y consumir state (previene replay)
  const stateRow = await pool.query(
    `select state, consumed_at from public.shopify_oauth_state where state=$1 and shop_domain=$2`,
    [state, shop]
  );

  if (!stateRow.rowCount) return res.status(401).send('Invalid state');
  if (stateRow.rows[0].consumed_at) return res.status(401).send('State already used');

  await pool.query(
    `update public.shopify_oauth_state set consumed_at=now() where state=$1`,
    [state]
  );

  // Intercambio code -> access_token
  const tokenRes = await fetch(`https://${shop}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code
    })
  });

  const tokenJson = await tokenRes.json();
  if (!tokenRes.ok) {
    return res.status(500).json({ error: 'Token exchange failed', details: tokenJson });
  }

  const accessToken = tokenJson.access_token;
  const scope = tokenJson.scope || null;

 await pool.query(
  `
  insert into public.shopify_store_token (shop_domain, access_token, scope)
  values ($1, $2, $3)
  on conflict (shop_domain)
  do update set access_token=excluded.access_token, scope=excluded.scope, updated_at=now()
  `,
  [shop, accessToken, scope]
);

// Verificación “hard”
const verify = await pool.query(
  `select shop_domain, scope, installed_at, updated_at
   from public.shopify_store_token
   where shop_domain=$1`,
  [shop]
);

if (!verify.rowCount) {
  // Si esto pasa, hay un problema serio de DB/transaction/target
  return res.status(500).json({ ok: false, error: 'Token not persisted', shop });
}

return res.status(200).json({
  ok: true,
  shop,
  scope,
  saved: true,
  savedRow: verify.rows[0]
});
});

router.get('/shopify/installed', async (req, res) => {
  const input = req.query.shop;
  if (!input) return res.status(400).json({ ok: false, error: 'Missing shop' });

  const shop = await resolveShopDomain(input);
  if (!shop) return res.status(404).json({ ok: false, shop: input, installed: false });

  const r = await pool.query(
    `select shop_domain, scope, installed_at, updated_at
     from public.shopify_store_token
     where shop_domain=$1`,
    [shop]
  );

  if (!r.rowCount) return res.status(404).json({ ok: false, shop: input, installed: false });

  return res.json({ ok: true, inputShop: input, shop, installed: true, ...r.rows[0] });
});

router.get('/shopify/debug', async (req, res) => {
  const input = req.query.shop;
  if (!input) return res.status(400).json({ ok: false, error: 'Missing shop' });

  const shop = await resolveShopDomain(input);

  const tokenRow = shop
    ? await pool.query(
        `select shop_domain, scope, installed_at, updated_at
         from public.shopify_store_token
         where shop_domain=$1`,
        [shop]
      )
    : { rowCount: 0, rows: [] };

  const states = shop
    ? await pool.query(
        `select state, created_at, consumed_at
         from public.shopify_oauth_state
         where shop_domain=$1
         order by created_at desc
         limit 10`,
        [shop]
      )
    : { rows: [] };

  return res.json({
    ok: true,
    inputShop: input,
    resolvedShop: shop,
    hasToken: Boolean(tokenRow.rowCount),
    tokenMeta: tokenRow.rowCount ? tokenRow.rows[0] : null,
    recentStates: states.rows,
  });
});


router.get('/shopify/dbinfo', async (req, res) => {
  const db = await pool.query('select current_database() as db, current_user as user, now() as now');
  const c1 = await pool.query('select count(*)::int as count from public.shopify_store_token');
  const c2 = await pool.query('select count(*)::int as count from public.shopify_oauth_state');
  res.json({
    ok: true,
    db: db.rows[0],
    counts: {
      shopify_store_token: c1.rows[0].count,
      shopify_oauth_state: c2.rows[0].count,
    }
  });
});




module.exports = router;
