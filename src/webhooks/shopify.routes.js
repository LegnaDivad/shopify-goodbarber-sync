const express = require('express');
const { verifyShopifyHmac } = require('./shopify.verify');
const { handleProductUpsert, handleProductDelete } = require('./shopify.handlers');

const router = express.Router();

// products/create y products/update usan el mismo handler
router.post('/products/create', verifyShopifyHmac, handleProductUpsert);
router.post('/products/update', verifyShopifyHmac, handleProductUpsert);

// delete tiene payload distinto
router.post('/products/delete', verifyShopifyHmac, handleProductDelete);

module.exports = router;
