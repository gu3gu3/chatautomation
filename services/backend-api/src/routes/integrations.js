import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { google } from 'googleapis';
import pino from 'pino';
import { pool } from '../db.js';
import { authenticateToken } from '../middleware/auth.js';

const logger = pino({ name: 'backend-api:integrations' });
const router = express.Router();

/**
 * Extrae limpiamente el Spreadsheet ID si el usuario pegó la URL completa de Google Sheets
 */
function extractSpreadsheetId(input) {
  if (!input) return '';
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

/**
 * Extrae limpiamente el Folder ID si el usuario pegó la URL completa de Google Drive
 */
function extractDriveFolderId(input) {
  if (!input) return '';
  const trimmed = input.trim();
  const match = trimmed.match(/\/folders\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

// GET /api/integrations - Obtener el estado e integraciones del tenant actual
router.get('/', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;

  try {
    const result = await pool.query(
      `SELECT integration_type, config, is_enabled, credentials_json IS NOT NULL as has_credentials, credentials_json, created_at, updated_at
       FROM tenant_integrations WHERE tenant_id = $1`,
      [tenantId]
    );

    const integrations = {
      GOOGLE_SHEETS: { is_enabled: false, config: {}, has_credentials: false },
      GOOGLE_CALENDAR: { is_enabled: false, config: {}, has_credentials: false },
      GOOGLE_DRIVE: { is_enabled: false, config: {}, has_credentials: false },
    };

    result.rows.forEach(row => {
      let accountEmail = row.config?.account_email || null;
      integrations[row.integration_type] = {
        is_enabled: row.is_enabled,
        config: row.config || {},
        has_credentials: row.has_credentials,
        account_email: accountEmail,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
    });

    res.json(integrations);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Helper para resolver dinámicamente el Redirect URI de Google OAuth
function getRedirectUri(req) {
  const forwardedHost = req.headers['x-forwarded-host'] || req.headers.host || '';
  const forwardedProto = req.headers['x-forwarded-proto'] || req.protocol || 'https';

  // Si la petición proviene de un dominio público (ej: ai.websavvy-solutions.com)
  if (forwardedHost && !forwardedHost.includes('localhost') && !forwardedHost.includes('127.0.0.1')) {
    return `${forwardedProto}://${forwardedHost}/api/integrations/google/callback`;
  }

  // Si GOOGLE_REDIRECT_URI está configurado en env y no apunta a localhost si estamos en prod
  if (process.env.GOOGLE_REDIRECT_URI && !process.env.GOOGLE_REDIRECT_URI.includes('localhost')) {
    return process.env.GOOGLE_REDIRECT_URI;
  }

  // Fallback desarrollo local
  return process.env.GOOGLE_REDIRECT_URI || `${forwardedProto}://${forwardedHost}/api/integrations/google/callback`;
}

// GET /api/integrations/google/auth-url - Genera la URL de autorización OAuth2 de Google
router.get('/google/auth-url', authenticateToken, (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const redirectUri = getRedirectUri(req);

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );

  const scopes = [
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
    'https://www.googleapis.com/auth/drive.readonly',
  ];

  const forwardedHost = req.headers['x-forwarded-host'] || req.headers.host || '';
  const forwardedProto = req.headers['x-forwarded-proto'] || req.protocol || 'https';
  const originHeader = req.headers.origin || req.headers.referer;
  let clientOrigin = `${forwardedProto}://${forwardedHost}`;
  if (originHeader) {
    try {
      const parsedUrl = new URL(originHeader);
      clientOrigin = `${parsedUrl.protocol}//${parsedUrl.host}`;
    } catch(e) {}
  }

  const state = Buffer.from(JSON.stringify({
    tenantId,
    clientHost: clientOrigin
  })).toString('base64');

  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Garantiza que siempre devuelva el refresh_token
    state,
  });

  res.json({ url });
});

// GET /api/integrations/google/callback - Callback de respuesta de Google OAuth2
router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error || !code) {
    return res.status(400).send(`Error de autenticación con Google: ${error || 'No se recibió código de autorización'}`);
  }

  let decodedState = {};
  try {
    decodedState = JSON.parse(Buffer.from(state, 'base64').toString('utf-8'));
  } catch (e) {}

  const tenantId = decodedState.tenantId;
  const returnOrigin = decodedState.clientHost || 'http://localhost:5174';

  if (!tenantId) {
    return res.status(400).send('Parámetro de estado inválido: falta tenantId');
  }

  try {
    const redirectUri = getRedirectUri(req);

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      redirectUri
    );

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Obtener información del usuario autenticado de Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userinfo = await oauth2.userinfo.get();
    const googleEmail = userinfo.data.email;

    // Guardar tokens de acceso y refresco en tenant_integrations para Sheets y Calendar
    const sheetsConfig = { account_email: googleEmail, default_sheet_name: 'Sheet1!A:Z' };
    const calendarConfig = { account_email: googleEmail, calendar_id: 'primary', timezone: 'America/Tegucigalpa' };

    // Insertar / Actualizar GOOGLE_SHEETS
    await pool.query(`
      INSERT INTO tenant_integrations (id, tenant_id, integration_type, credentials_json, config, is_enabled, updated_at)
      VALUES ($1, $2, 'GOOGLE_SHEETS', $3, $4, TRUE, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, integration_type)
      DO UPDATE SET credentials_json = EXCLUDED.credentials_json, config = tenant_integrations.config || EXCLUDED.config, is_enabled = TRUE, updated_at = CURRENT_TIMESTAMP
    `, [`integ-${uuidv4().substring(0, 8)}`, tenantId, tokens, sheetsConfig]);

    // Insertar / Actualizar GOOGLE_CALENDAR
    await pool.query(`
      INSERT INTO tenant_integrations (id, tenant_id, integration_type, credentials_json, config, is_enabled, updated_at)
      VALUES ($1, $2, 'GOOGLE_CALENDAR', $3, $4, TRUE, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, integration_type)
      DO UPDATE SET credentials_json = EXCLUDED.credentials_json, config = tenant_integrations.config || EXCLUDED.config, is_enabled = TRUE, updated_at = CURRENT_TIMESTAMP
    `, [`integ-${uuidv4().substring(0, 8)}`, tenantId, tokens, calendarConfig]);

    // Insertar / Actualizar GOOGLE_DRIVE
    const driveConfig = { account_email: googleEmail, folder_id: '' };
    await pool.query(`
      INSERT INTO tenant_integrations (id, tenant_id, integration_type, credentials_json, config, is_enabled, updated_at)
      VALUES ($1, $2, 'GOOGLE_DRIVE', $3, $4, TRUE, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, integration_type)
      DO UPDATE SET credentials_json = EXCLUDED.credentials_json, config = tenant_integrations.config || EXCLUDED.config, is_enabled = TRUE, updated_at = CURRENT_TIMESTAMP
    `, [`integ-${uuidv4().substring(0, 8)}`, tenantId, tokens, driveConfig]);

    logger.info({ tenantId, googleEmail }, 'Cuenta de Google conectada exitosamente via OAuth2');

    // Redireccionar al panel PWA con éxito y parámetro tab=tools
    res.redirect(`${returnOrigin}/?google_connected=true&tab=tools&email=${encodeURIComponent(googleEmail)}`);
  } catch (err) {
    logger.error({ err }, 'Error procesando callback OAuth2 de Google');
    res.status(500).send(`Error procesando la autenticación de Google: ${err.message}`);
  }
});

// POST /api/integrations/sheets - Guardar o actualizar configuración de Google Sheets
router.post('/sheets', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { spreadsheet_id, default_sheet_name, credentials_json, is_enabled } = req.body;

  try {
    const cleanSpreadsheetId = extractSpreadsheetId(spreadsheet_id);

    const config = {
      spreadsheet_id: cleanSpreadsheetId,
      default_sheet_name: default_sheet_name || 'Sheet1!A:Z',
    };

    let query;
    let params;

    if (credentials_json) {
      let parsedCreds = credentials_json;
      if (typeof credentials_json === 'string') {
        parsedCreds = JSON.parse(credentials_json);
      }
      query = `
        INSERT INTO tenant_integrations (id, tenant_id, integration_type, credentials_json, config, is_enabled, updated_at)
        VALUES ($1, $2, 'GOOGLE_SHEETS', $3, $4, $5, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, integration_type)
        DO UPDATE SET credentials_json = EXCLUDED.credentials_json, config = tenant_integrations.config || EXCLUDED.config, is_enabled = EXCLUDED.is_enabled, updated_at = CURRENT_TIMESTAMP
        RETURNING integration_type, config, is_enabled, credentials_json IS NOT NULL as has_credentials;
      `;
      params = [`integ-${uuidv4().substring(0, 8)}`, tenantId, parsedCreds, config, is_enabled ?? true];
    } else {
      query = `
        INSERT INTO tenant_integrations (id, tenant_id, integration_type, config, is_enabled, updated_at)
        VALUES ($1, $2, 'GOOGLE_SHEETS', $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, integration_type)
        DO UPDATE SET config = tenant_integrations.config || EXCLUDED.config, is_enabled = EXCLUDED.is_enabled, updated_at = CURRENT_TIMESTAMP
        RETURNING integration_type, config, is_enabled, credentials_json IS NOT NULL as has_credentials;
      `;
      params = [`integ-${uuidv4().substring(0, 8)}`, tenantId, config, is_enabled ?? true];
    }

    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/integrations/calendar - Guardar o actualizar configuración de Google Calendar
router.post('/calendar', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { calendar_id, timezone, credentials_json, is_enabled } = req.body;

  try {
    const config = {
      calendar_id: calendar_id || 'primary',
      timezone: timezone || 'America/Tegucigalpa',
    };

    let query;
    let params;

    if (credentials_json) {
      let parsedCreds = credentials_json;
      if (typeof credentials_json === 'string') {
        parsedCreds = JSON.parse(credentials_json);
      }
      query = `
        INSERT INTO tenant_integrations (id, tenant_id, integration_type, credentials_json, config, is_enabled, updated_at)
        VALUES ($1, $2, 'GOOGLE_CALENDAR', $3, $4, $5, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, integration_type)
        DO UPDATE SET credentials_json = EXCLUDED.credentials_json, config = tenant_integrations.config || EXCLUDED.config, is_enabled = EXCLUDED.is_enabled, updated_at = CURRENT_TIMESTAMP
        RETURNING integration_type, config, is_enabled, credentials_json IS NOT NULL as has_credentials;
      `;
      params = [`integ-${uuidv4().substring(0, 8)}`, tenantId, parsedCreds, config, is_enabled ?? true];
    } else {
      query = `
        INSERT INTO tenant_integrations (id, tenant_id, integration_type, config, is_enabled, updated_at)
        VALUES ($1, $2, 'GOOGLE_CALENDAR', $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, integration_type)
        DO UPDATE SET config = tenant_integrations.config || EXCLUDED.config, is_enabled = EXCLUDED.is_enabled, updated_at = CURRENT_TIMESTAMP
        RETURNING integration_type, config, is_enabled, credentials_json IS NOT NULL as has_credentials;
      `;
      params = [`integ-${uuidv4().substring(0, 8)}`, tenantId, config, is_enabled ?? true];
    }

    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/integrations/drive - Guardar o actualizar configuración de Google Drive
router.post('/drive', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { folder_id, credentials_json, is_enabled } = req.body;

  try {
    const cleanFolderId = extractDriveFolderId(folder_id);
    const config = {
      folder_id: cleanFolderId,
    };

    let query;
    let params;

    if (credentials_json) {
      let parsedCreds = credentials_json;
      if (typeof credentials_json === 'string') {
        parsedCreds = JSON.parse(credentials_json);
      }
      query = `
        INSERT INTO tenant_integrations (id, tenant_id, integration_type, credentials_json, config, is_enabled, updated_at)
        VALUES ($1, $2, 'GOOGLE_DRIVE', $3, $4, $5, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, integration_type)
        DO UPDATE SET credentials_json = EXCLUDED.credentials_json, config = tenant_integrations.config || EXCLUDED.config, is_enabled = EXCLUDED.is_enabled, updated_at = CURRENT_TIMESTAMP
        RETURNING integration_type, config, is_enabled, credentials_json IS NOT NULL as has_credentials;
      `;
      params = [`integ-${uuidv4().substring(0, 8)}`, tenantId, parsedCreds, config, is_enabled ?? true];
    } else {
      query = `
        INSERT INTO tenant_integrations (id, tenant_id, integration_type, config, is_enabled, updated_at)
        VALUES ($1, $2, 'GOOGLE_DRIVE', $3, $4, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, integration_type)
        DO UPDATE SET config = tenant_integrations.config || EXCLUDED.config, is_enabled = EXCLUDED.is_enabled, updated_at = CURRENT_TIMESTAMP
        RETURNING integration_type, config, is_enabled, credentials_json IS NOT NULL as has_credentials;
      `;
      params = [`integ-${uuidv4().substring(0, 8)}`, tenantId, config, is_enabled ?? true];
    }

    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * Formatea errores provenientes de Google API para dar mensajes claros al usuario
 */
function formatGoogleError(error) {
  const errStr = String(error?.message || error?.response?.data?.error || error || '');
  if (errStr.includes('invalid_grant') || errStr.includes('expired or revoked') || error?.response?.data?.error === 'invalid_grant') {
    return 'La sesión de Google ha expirado o fue revocada. Por favor haz clic en "Reconectar / Cambiar Cuenta de Google" para volver a autorizar.';
  }
  return error?.message || 'Error al comunicarse con la API de Google';
}

// POST /api/integrations/test - Probar conexión con Google Sheets o Calendar
router.post('/test', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;
  const { integration_type, credentials_json, config } = req.body;

  try {
    let creds = credentials_json;
    if (!creds) {
      const dbRes = await pool.query(
        `SELECT credentials_json, config FROM tenant_integrations WHERE tenant_id = $1 AND integration_type = $2`,
        [tenantId, integration_type]
      );
      if (dbRes.rows.length === 0 || !dbRes.rows[0].credentials_json) {
        return res.status(400).json({ success: false, error: 'No existen credenciales OAuth guardadas para esta integración. Por favor haz clic en "Conectar con Google".' });
      }
      creds = dbRes.rows[0].credentials_json;
    }

    if (typeof creds === 'string') {
      creds = JSON.parse(creds);
    }

    let auth;
    if (creds.type === 'service_account') {
      auth = google.auth.fromJSON(creds);
      auth.scopes = [
        integration_type === 'GOOGLE_SHEETS' 
          ? 'https://www.googleapis.com/auth/spreadsheets.readonly'
          : 'https://www.googleapis.com/auth/calendar.readonly'
      ];
    } else {
      const oAuth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );
      oAuth2Client.setCredentials(creds);
      auth = oAuth2Client;
    }

    if (integration_type === 'GOOGLE_SHEETS') {
      const sheets = google.sheets({ version: 'v4', auth });
      const rawId = config?.spreadsheet_id || req.body.spreadsheet_id;
      const spreadsheetId = extractSpreadsheetId(rawId);

      if (!spreadsheetId) {
        return res.status(400).json({ success: false, error: 'Falta proporcionar la URL o ID de la Hoja de Cálculo.' });
      }

      const response = await sheets.spreadsheets.get({ spreadsheetId });
      return res.json({
        success: true,
        message: `¡Conexión exitosa! Hoja encontrada: "${response.data.properties.title}"`,
      });
    }

    if (integration_type === 'GOOGLE_CALENDAR') {
      const calendar = google.calendar({ version: 'v3', auth });
      const calendarId = config?.calendar_id || req.body.calendar_id || 'primary';

      const response = await calendar.calendars.get({ calendarId });
      return res.json({
        success: true,
        message: `¡Conexión exitosa! Calendario encontrado: "${response.data.summary}" (${response.data.timeZone})`,
      });
    }

    return res.status(400).json({ success: false, error: 'Tipo de integración no soportado' });
  } catch (error) {
    const formattedError = formatGoogleError(error);
    logger.warn({ error: error.message, tenantId, integration_type }, 'Error probando integración con Google');
    res.status(400).json({ success: false, error: formattedError });
  }
});

// POST /api/integrations/google/sync-sheets-embeddings - Sincroniza la Hoja de Cálculo con la Tabla de Embeddings de Catálogo
router.post('/google/sync-sheets-embeddings', authenticateToken, async (req, res) => {
  const tenantId = req.user.effectiveTenantId;

  try {
    const dbRes = await pool.query(
      `SELECT credentials_json, config FROM tenant_integrations WHERE tenant_id = $1 AND integration_type = 'GOOGLE_SHEETS' AND is_enabled = TRUE`,
      [tenantId]
    );

    if (dbRes.rows.length === 0 || !dbRes.rows[0].credentials_json) {
      return res.status(400).json({ success: false, error: 'La integración de Google Sheets no está activa o no tiene credenciales válidas.' });
    }

    const { credentials_json, config } = dbRes.rows[0];
    const spreadsheetId = extractSpreadsheetId(config.spreadsheet_id);
    const range = config.default_sheet_name || 'Inventario!A:Z';

    const oAuth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oAuth2Client.setCredentials(typeof credentials_json === 'string' ? JSON.parse(credentials_json) : credentials_json);

    const sheets = google.sheets({ version: 'v4', auth: oAuth2Client });
    const response = await sheets.spreadsheets.values.get({ spreadsheetId, range });

    const rows = response.data.values || [];
    if (rows.length <= 1) {
      return res.json({ success: true, message: 'La hoja de cálculo está vacía o solo contiene encabezados.', syncedCount: 0 });
    }

    const header = rows[0].map(h => String(h).trim().toLowerCase());
    const getColIndex = (name) => header.findIndex(h => h === name || h.includes(name));

    const codeIdx = getColIndex('codigo') !== -1 ? getColIndex('codigo') : 0;
    const nameIdx = getColIndex('nombre') !== -1 ? getColIndex('nombre') : 1;
    const catIdx = getColIndex('categoria') !== -1 ? getColIndex('categoria') : 2;
    const descIdx = getColIndex('descripcion') !== -1 ? getColIndex('descripcion') : 3;
    const sizesIdx = getColIndex('talla') !== -1 ? getColIndex('talla') : 4;
    const priceIdx = getColIndex('precio') !== -1 ? getColIndex('precio') : 5;
    const currIdx = getColIndex('moneda') !== -1 ? getColIndex('moneda') : 6;
    const contactDistIdx = getColIndex('contact') !== -1 ? getColIndex('contact') : 7;
    const distAIdx = getColIndex('distribuidor_a');
    const distBIdx = getColIndex('distribuidor_b');

    let syncedCount = 0;

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length === 0) continue;

      const productCode = String(row[codeIdx] || '').trim();
      const productName = String(row[nameIdx] || '').trim();
      if (!productCode && !productName) continue;

      const category = String(row[catIdx] || '').trim();
      const description = String(row[descIdx] || '').trim();
      const sizes = String(row[sizesIdx] || '').trim();
      const priceRaw = String(row[priceIdx] || '0').replace(/[^0-9.]/g, '');
      const price = parseFloat(priceRaw) || 0.00;
      const currency = String(row[currIdx] || 'C$').trim();
      const contactDist = String(row[contactDistIdx] || 'no').trim().toLowerCase();
      const distA = distAIdx !== -1 ? String(row[distAIdx] || '').trim() : '';
      const distB = distBIdx !== -1 ? String(row[distBIdx] || '').trim() : '';

      const rawJson = {
        row_index: i,
        product_code: productCode,
        product_name: productName,
        category,
        description,
        available_sizes: sizes,
        price,
        currency,
        contact_distributor: contactDist,
        distribuidor_a: distA,
        distribuidor_b: distB,
      };

      const recordId = `cat-${tenantId}-${productCode || uuidv4().substring(0, 6)}`;

      await pool.query(
        `INSERT INTO tenant_catalog_embeddings 
         (tenant_id, product_code, title, category, description, price_cs, contact_distributor, distributor_a, distributor_b)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, product_code)
         DO UPDATE SET 
           title = EXCLUDED.title,
           category = EXCLUDED.category,
           description = EXCLUDED.description,
           price_cs = EXCLUDED.price_cs,
           contact_distributor = EXCLUDED.contact_distributor,
           distributor_a = EXCLUDED.distributor_a,
           distributor_b = EXCLUDED.distributor_b`,
        [tenantId, productCode, productName, category, `${description} (Tallas: ${sizes})`, price, contactDist, distA, distB]
      );

      syncedCount++;
    }

    logger.info({ tenantId, syncedCount }, 'Inventario de Google Sheets sincronizado exitosamente con la tabla de embeddings');
    res.json({
      success: true,
      message: `¡Sincronización completada con éxito! Se procesaron ${syncedCount} productos de la hoja "${range}".`,
      syncedCount,
    });
  } catch (error) {
    const formattedError = formatGoogleError(error);
    logger.error({ error: error.message }, 'Error en sincronización de Google Sheets a embeddings');
    res.status(400).json({ success: false, error: formattedError });
  }
});

export default router;
