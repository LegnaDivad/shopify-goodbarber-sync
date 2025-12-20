const express = require('express');
const router = express.Router();
const { gbRequest } = require('../services/goodbarberClient');
const { goodbarberConfig } = require('../config/goodbarber');

router.get('/goodbarber/ping', async (req, res, next) => {
  try {
    // Importante: aquí ponemos un PATH “probable” y fácil de ajustar.
    // En cuanto tengas el endpoint exacto de tu doc/entorno GB, lo cambiamos.
    // Objetivo: validar auth y conectividad.
    const result = await gbRequest(`/publicapi/v2/documentation/`, { method: 'GET' });
    return res.json({
      ok: true,
      appId: goodbarberConfig.appId,
      note: 'Si este endpoint no retorna JSON, cambia el path por un endpoint real de datos (catalog/products, etc.)',
      result,
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
