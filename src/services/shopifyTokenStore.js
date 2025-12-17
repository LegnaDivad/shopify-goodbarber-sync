const { pool } = require('../config/db');
const { resolveShopDomain } = require('./shopifyShopResolver');

async function getShopifyAccessToken(shopOrAlias) {
  const shopDomain = await resolveShopDomain(shopOrAlias);
  if (!shopDomain) return { shopDomain: null, accessToken: null };

  const r = await pool.query(
    `select access_token from public.shopify_store_token where shop_domain=$1`,
    [shopDomain]
  );

  return { shopDomain, accessToken: r.rowCount ? r.rows[0].access_token : null };
}

module.exports = { getShopifyAccessToken };
