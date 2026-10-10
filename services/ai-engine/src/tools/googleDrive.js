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
    // 1. Sanitizar la consulta eliminando extensiones de archivo y caracteres que puedan romper la sintaxis de Google Drive API
    const rawClean = (fileQuery || '').replace(/\.(png|jpg|jpeg|pdf|webp|docx?|xlsx?)/gi, '').trim();
    const sanitizedQuery = rawClean.replace(/['"\\]/g, '').trim();

    let queryClause = `trashed = false`;
    if (folderId) {
      const cleanFolderId = folderId.trim();
      queryClause += ` and '${cleanFolderId}' in parents`;
    }

    logger.info({ folderId, fileQuery, sanitizedQuery }, 'Buscando archivo en Google Drive (Búsqueda Genérica)...');

    // Intento 1: Búsqueda por subcadena exacta en el nombre del archivo
    let searchRes = await drive.files.list({
      q: `${queryClause} and name contains '${sanitizedQuery}'`,
      fields: 'files(id, name, mimeType, size)',
      pageSize: 10,
    }).catch(err => {
      logger.warn({ err: err.message }, 'Advertencia en consulta directa de Google Drive API');
      return null;
    });

    let files = searchRes?.data?.files || [];

    // Intento 2: Si no hay coincidencia exacta del string completo, listar archivos de la carpeta y comparar nombres por coincidencia de palabras
    if (files.length === 0 && folderId) {
      const folderRes = await drive.files.list({
        q: queryClause,
        fields: 'files(id, name, mimeType, size)',
        pageSize: 50,
      }).catch(() => null);

      const allFiles = folderRes?.data?.files || [];
      const queryTokens = sanitizedQuery.toLowerCase().split(/[\s_.-]+/).filter(t => t.length > 1);

      if (allFiles.length > 0 && queryTokens.length > 0) {
        // Encontrar el archivo cuyo nombre coincida con la mayor cantidad de palabras clave del query
        let bestMatch = null;
        let maxScore = 0;

        for (const file of allFiles) {
          const fileNameLower = file.name.toLowerCase();
          let score = 0;
          for (const token of queryTokens) {
            if (fileNameLower.includes(token)) {
              score++;
            }
          }
          if (score > maxScore) {
            maxScore = score;
            bestMatch = file;
          }
        }

        if (bestMatch && maxScore > 0) {
          files = [bestMatch];
        } else {
          logger.warn({ folderId, fileQuery, sanitizedQuery }, 'No se encontraron archivos en Google Drive que coincidan con las palabras clave.');
          return { success: false, error: `No se encontraron archivos en Google Drive que coincidan con "${fileQuery}"` };
        }
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

    // 2. Descargar o exportar según el tipo de archivo (Docs/Sheets/Slides a PDF o binario directo)
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
