const crypto = require('crypto');

function timingSafeEquals(a, b) {
  const aBuf = Buffer.from(a || '', 'utf8');
  const bBuf = Buffer.from(b || '', 'utf8');

  // timingSafeEqual requiere mismo length
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function verifyShopifyHmac(req, res, next) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const hmacHeader = req.get('x-shopify-hmac-sha256');

  if (!secret) {
    return res.status(500).json({ error: 'Missing SHOPIFY_WEBHOOK_SECRET' });
  }
  if (!req.rawBody) {
    return res.status(400).json({ error: 'Missing rawBody (check express.json verify)' });
  }
  if (!hmacHeader) {
    return res.status(401).json({ error: 'Missing X-Shopify-Hmac-Sha256 header' });
  }

  const computed = crypto
    .createHmac('sha256', secret)
    .update(req.rawBody)
    .digest('base64');

  if (!timingSafeEquals(computed, hmacHeader)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  return next();
}

module.exports = { verifyShopifyHmac };
