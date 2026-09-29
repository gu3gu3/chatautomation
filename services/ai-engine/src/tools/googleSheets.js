import { google } from 'googleapis';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Helper to obtain authenticated Google Sheets client from Service Account or OAuth2 Tokens
 */
function getSheetsClient(credentialsJson) {
  let parsedCreds = credentialsJson;
  if (typeof credentialsJson === 'string') {
    parsedCreds = JSON.parse(credentialsJson);
  }

  let auth;
  if (parsedCreds.type === 'service_account') {
    auth = google.auth.fromJSON(parsedCreds);
    auth.scopes = [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/spreadsheets.readonly'
    ];
  } else {
    // OAuth2 tokens (refresh_token / access_token)
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(parsedCreds);
    auth = oauth2Client;
  }

  return google.sheets({ version: 'v4', auth });
}

/**
 * Reads a range from Google Sheets (e.g. FAQ, Catalog, Prices) with automatic tab fallback
 */
export async function readSheetRange({ credentials, spreadsheetId, range = 'A:Z' }) {
  const sheets = getSheetsClient(credentials);

  try {
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    const rows = response.data.values || [];
    logger.info({ spreadsheetId, range, rowCount: rows.length }, 'Google Sheets read successfully via OAuth2');
    return { success: true, rows, totalRows: rows.length };
  } catch (error) {
    logger.warn({ err: error.message, spreadsheetId, failedRange: range }, 'Error reading Google Sheet with requested range. Retrying with fallback range "A:Z"...');

    // Fallback: Si el nombre de la pestaña adivinado por Gemini (ej: "Productos!A:F") no existe en la hoja del usuario,
    // consultar sin prefijo de pestaña ("A:Z") para forzar a Google Sheets API a leer la primera pestaña predeterminada.
    try {
      const fallbackResponse = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: 'A:Z',
      });
      const rows = fallbackResponse.data.values || [];
      logger.info({ spreadsheetId, fallbackRange: 'A:Z', rowCount: rows.length }, 'Google Sheets fallback read succeeded!');
      return { success: true, rows, totalRows: rows.length };
    } catch (fallbackError) {
      logger.error({ err: fallbackError.message, spreadsheetId }, 'Fallback error reading Google Sheet');
      return { success: false, error: fallbackError.message, rows: [] };
    }
  }
}

/**
 * Appends a row of values to Google Sheets (e.g. Lead registration) with automatic tab fallback
 */
export async function appendSheetRow({ credentials, spreadsheetId, range = 'A:Z', values = [] }) {
  const sheets = getSheetsClient(credentials);

  try {
    const targetRange = (range && range.includes('!')) ? range : 'A:Z';
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: targetRange,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: {
        values: [values],
      },
    });
    logger.info({ spreadsheetId, updatedRange: response.data.updates?.updatedRange }, 'Google Sheet row appended successfully via OAuth2');
    return {
      success: true,
      updatedRange: response.data.updates?.updatedRange,
      updatedRows: response.data.updates?.updatedRows,
    };
  } catch (error) {
    logger.warn({ err: error.message, spreadsheetId, failedRange: range }, 'Error appending to Google Sheet. Retrying with fallback range "A:Z"...');
    try {
      const response = await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: 'A:Z',
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: {
          values: [values],
        },
      });
      return {
        success: true,
        updatedRange: response.data.updates?.updatedRange,
        updatedRows: response.data.updates?.updatedRows,
      };
    } catch (fallbackError) {
      logger.error({ err: fallbackError.message, spreadsheetId }, 'Error appending to Google Sheet');
      return { success: false, error: fallbackError.message };
    }
  }
}
