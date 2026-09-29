import { google } from 'googleapis';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Helper para obtener cliente autenticado de Google Drive v3 a partir de OAuth2 o Service Account
 */
function getDriveClient(credentialsJson) {
  let parsedCreds = credentialsJson;
  if (typeof credentialsJson === 'string') {
    parsedCreds = JSON.parse(credentialsJson);
  }

  let auth;
  if (parsedCreds.type === 'service_account') {
    auth = google.auth.fromJSON(parsedCreds);
    auth.scopes = [
      'https://www.googleapis.com/auth/drive.readonly',
      'https://www.googleapis.com/auth/drive'
    ];
  } else {
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );
    oauth2Client.setCredentials(parsedCreds);
    auth = oauth2Client;
  }

  return google.drive({ version: 'v3', auth });
}

/**
 * Busca y descarga en tiempo real un archivo (imagen, PDF, promoción) desde una carpeta de Google Drive
 */
export async function searchAndDownloadDriveFile({ credentials, folderId, fileQuery }) {
  const drive = getDriveClient(credentials);

  try {
    const cleanQuery = (fileQuery || '').replace(/'/g, "\\'").trim();
    
    let queryClause = `trashed = false`;
    if (folderId) {
      const cleanFolderId = folderId.trim();
      queryClause += ` and '${cleanFolderId}' in parents`;
    }
    if (cleanQuery) {
      queryClause += ` and (name contains '${cleanQuery}' or fullText contains '${cleanQuery}')`;
    }

    logger.info({ folderId, fileQuery, queryClause }, 'Buscando archivos en Google Drive...');

    // 1. Buscar archivos en la carpeta de Google Drive
    const listRes = await drive.files.list({
      q: queryClause,
      fields: 'files(id, name, mimeType, size)',
      pageSize: 5,
    });

    let files = listRes.data.files || [];

    // Fallback 1: Si la palabra clave exacta no coincide, intentar buscar por fragmentos de palabras
    if (files.length === 0 && cleanQuery) {
      const words = cleanQuery.split(/\s+/).filter(w => w.length > 2);
      for (const word of words) {
        const cleanWord = word.replace(/'/g, "\\'");
        const fallbackQuery = `trashed = false${folderId ? ` and '${folderId}' in parents` : ''} and (name contains '${cleanWord}' or fullText contains '${cleanWord}')`;
        const fbRes = await drive.files.list({
          q: fallbackQuery,
          fields: 'files(id, name, mimeType, size)',
          pageSize: 5,
        });
        if (fbRes.data.files && fbRes.data.files.length > 0) {
          files = fbRes.data.files;
          break;
        }
      }
    }

    // Fallback 2: Si aún no se encuentra coincidencia por palabra clave, traer el primer archivo disponible en la carpeta
    if (files.length === 0 && folderId) {
      const folderFallbackQuery = `trashed = false and '${folderId.trim()}' in parents`;
      const folderRes = await drive.files.list({
        q: folderFallbackQuery,
        fields: 'files(id, name, mimeType, size)',
        pageSize: 5,
      });
      if (folderRes.data.files && folderRes.data.files.length > 0) {
        files = folderRes.data.files;
      }
    }

    if (files.length === 0) {
      return { success: false, error: `No se encontraron archivos en Google Drive para la consulta: "${fileQuery}"` };
    }

    const targetFile = files[0];
    logger.info({ fileId: targetFile.id, fileName: targetFile.name, mimeType: targetFile.mimeType }, 'Archivo localizado en Google Drive. Descargando...');

    let downloadRes;
    let finalMimeType = targetFile.mimeType;
    let finalFileName = targetFile.name;

    // 2. Descargar o exportar según el tipo de archivo (Soporte para Google Docs/Sheets/Slides a PDF)
    if (targetFile.mimeType === 'application/vnd.google-apps.document' || 
        targetFile.mimeType === 'application/vnd.google-apps.spreadsheet' || 
        targetFile.mimeType === 'application/vnd.google-apps.presentation') {
      finalMimeType = 'application/pdf';
      if (!finalFileName.toLowerCase().endsWith('.pdf')) {
        finalFileName = `${finalFileName}.pdf`;
      }
      downloadRes = await drive.files.export(
        { fileId: targetFile.id, mimeType: 'application/pdf' },
        { responseType: 'arraybuffer' }
      );
    } else {
      downloadRes = await drive.files.get(
        { fileId: targetFile.id, alt: 'media' },
        { responseType: 'arraybuffer' }
      );
    }

    const buffer = Buffer.from(downloadRes.data);
    const mediaBase64 = buffer.toString('base64');

    return {
      success: true,
      fileId: targetFile.id,
      fileName: finalFileName,
      mimeType: finalMimeType,
      mediaBase64,
    };
  } catch (error) {
    logger.error({ err: error.message, folderId, fileQuery }, 'Error al buscar/descargar archivo de Google Drive');
    return { success: false, error: error.message };
  }
}
