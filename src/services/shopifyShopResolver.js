const { pool } = require('../config/db');

async function resolveShopDomain(input) {
  if (!input) return null;

  const shopOrAlias = String(input).trim().toLowerCase();

  // 1) Si ya existe como shop_domain instalado, úsalo directo
  const direct = await pool.query(
    `select shop_domain
     from public.shopify_store_token
     where shop_domain = $1`,
    [shopOrAlias]
  );
  if (direct.rowCount) return direct.rows[0].shop_domain;

  // 2) Si no, intenta alias
  const alias = await pool.query(
    `select shop_domain
     from public.shopify_shop_alias
     where alias = $1`,
    [shopOrAlias]
  );
  if (alias.rowCount) return alias.rows[0].shop_domain;

  return null;
}

module.exports = { resolveShopDomain };
