import { google } from 'googleapis';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

/**
 * Helper to obtain authenticated Google Calendar client from Service Account or OAuth2 Tokens
 */
function getCalendarClient(credentialsJson) {
  let parsedCreds = credentialsJson;
  if (typeof credentialsJson === 'string') {
    parsedCreds = JSON.parse(credentialsJson);
  }

  let auth;
  if (parsedCreds.type === 'service_account') {
    auth = google.auth.fromJSON(parsedCreds);
    auth.scopes = [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events'
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

  return google.calendar({ version: 'v3', auth });
}

/**
 * Checks free/busy availability in Google Calendar for a date range
 */
export async function checkAvailability({ credentials, calendarId = 'primary', timeMin, timeMax, timeZone = 'UTC' }) {
  try {
    const calendar = getCalendarClient(credentials);
    const response = await calendar.freebusy.query({
      requestBody: {
        timeMin,
        timeMax,
        timeZone,
        items: [{ id: calendarId }],
      },
    });

    const busySlots = response.data.calendars?.[calendarId]?.busy || [];
    logger.info({ calendarId, timeMin, timeMax, busySlotsCount: busySlots.length }, 'Calendar freebusy checked via OAuth2');
    return {
      success: true,
      timeZone,
      isAvailable: busySlots.length === 0,
      busySlots,
    };
  } catch (error) {
    logger.error({ err: error.message, calendarId }, 'Error checking Calendar availability');
    return { success: false, error: error.message, busySlots: [] };
  }
}

/**
 * Creates an event in Google Calendar
 */
export async function createCalendarEvent({
  credentials,
  calendarId = 'primary',
  summary,
  description = '',
  startIso,
  endIso,
  attendeeEmail,
  timeZone = 'UTC',
}) {
  try {
    const calendar = getCalendarClient(credentials);

    const eventRequestBody = {
      summary,
      description,
      start: { dateTime: startIso, timeZone },
      end: { dateTime: endIso, timeZone },
    };

    if (attendeeEmail) {
      eventRequestBody.attendees = [{ email: attendeeEmail }];
    }

    const response = await calendar.events.insert({
      calendarId,
      requestBody: eventRequestBody,
    });

    logger.info({ calendarId, eventId: response.data.id, htmlLink: response.data.htmlLink }, 'Calendar event created successfully via OAuth2');
    return {
      success: true,
      eventId: response.data.id,
      htmlLink: response.data.htmlLink,
      summary: response.data.summary,
      start: response.data.start,
      end: response.data.end,
    };
  } catch (error) {
    logger.error({ err: error.message, calendarId }, 'Error creating Calendar event');
    return { success: false, error: error.message };
  }
}
