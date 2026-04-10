/**
 * Google Calendar integration for booking sync.
 *
 * Pattern: DB is source of truth, Google Calendar is a sync target.
 * - On CONFIRMED: create event in the resource's Google Calendar
 * - On CANCELLED: delete event from Google Calendar
 * - Errors are logged but never block the booking flow
 */

import { google } from "googleapis";

export type CalendarEvent = {
  summary: string;
  description?: string;
  startTime: Date;
  endTime: Date;
  location?: string;
};

export type CalendarSyncResult = {
  success: boolean;
  eventId?: string;
  error?: string;
};

let calendarClient: ReturnType<typeof google.calendar> | null = null;

function getCalendarClient() {
  if (calendarClient) return calendarClient;

  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    return null;
  }

  try {
    const credentials = JSON.parse(keyJson);
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/calendar"],
    });

    calendarClient = google.calendar({ version: "v3", auth });
    return calendarClient;
  } catch (err) {
    console.error("[GoogleCalendar] Failed to initialize client:", err);
    return null;
  }
}

/**
 * Create a calendar event for a confirmed booking.
 */
export async function createCalendarEvent(
  googleCalendarId: string,
  event: CalendarEvent
): Promise<CalendarSyncResult> {
  const calendar = getCalendarClient();
  if (!calendar) {
    console.warn("[GoogleCalendar] Client not configured, skipping event creation");
    return { success: false, error: "Google Calendar not configured" };
  }

  try {
    const response = await calendar.events.insert({
      calendarId: googleCalendarId,
      requestBody: {
        summary: event.summary,
        description: event.description,
        location: event.location || "Бизнес-парк Деловой, Селятино",
        start: {
          dateTime: event.startTime.toISOString(),
          timeZone: "Europe/Moscow",
        },
        end: {
          dateTime: event.endTime.toISOString(),
          timeZone: "Europe/Moscow",
        },
      },
    });

    const eventId = response.data.id;
    console.log(`[GoogleCalendar] Event created: ${eventId} in ${googleCalendarId}`);
    return { success: true, eventId: eventId || undefined };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[GoogleCalendar] Failed to create event:`, message);
    return { success: false, error: message };
  }
}

/**
 * Delete a calendar event when booking is cancelled.
 */
export async function deleteCalendarEvent(
  googleCalendarId: string,
  eventId: string
): Promise<CalendarSyncResult> {
  const calendar = getCalendarClient();
  if (!calendar) {
    return { success: false, error: "Google Calendar not configured" };
  }

  try {
    await calendar.events.delete({
      calendarId: googleCalendarId,
      eventId,
    });

    console.log(`[GoogleCalendar] Event deleted: ${eventId}`);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[GoogleCalendar] Failed to delete event:`, message);
    return { success: false, error: message };
  }
}

/**
 * Update a calendar event (e.g., time change).
 */
export async function updateCalendarEvent(
  googleCalendarId: string,
  eventId: string,
  event: Partial<CalendarEvent>
): Promise<CalendarSyncResult> {
  const calendar = getCalendarClient();
  if (!calendar) {
    return { success: false, error: "Google Calendar not configured" };
  }

  try {
    await calendar.events.patch({
      calendarId: googleCalendarId,
      eventId,
      requestBody: {
        ...(event.summary && { summary: event.summary }),
        ...(event.description && { description: event.description }),
        ...(event.startTime && {
          start: { dateTime: event.startTime.toISOString(), timeZone: "Europe/Moscow" },
        }),
        ...(event.endTime && {
          end: { dateTime: event.endTime.toISOString(), timeZone: "Europe/Moscow" },
        }),
      },
    });

    console.log(`[GoogleCalendar] Event updated: ${eventId}`);
    return { success: true, eventId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[GoogleCalendar] Failed to update event:`, message);
    return { success: false, error: message };
  }
}
