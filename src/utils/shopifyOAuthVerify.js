const crypto = require('crypto');

function isValidShopDomain(shop) {
  return typeof shop === 'string'
    && /^[a-z0-9][a-z0-9\-]*\.myshopify\.com$/i.test(shop);
}

function verifyShopifyQueryHmac(query, clientSecret) {
  const { hmac, signature, ...rest } = query;
  if (!hmac) return false;

  const message = Object.keys(rest)
    .sort()
    .map((k) => `${k}=${Array.isArray(rest[k]) ? rest[k].join(',') : rest[k]}`)
    .join('&');

  const digest = crypto
    .createHmac('sha256', clientSecret)
    .update(message)
    .digest('hex');

  const a = Buffer.from(digest, 'utf8');
  const b = Buffer.from(String(hmac), 'utf8');
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

function newState() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { isValidShopDomain, verifyShopifyQueryHmac, newState };
