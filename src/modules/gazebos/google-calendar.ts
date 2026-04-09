/**
 * Google Calendar integration for gazebo bookings.
 *
 * Each gazebo has its own Google Calendar. When a booking is confirmed,
 * an event is created in the corresponding calendar. When cancelled, the event is removed.
 *
 * TODO: Implement when Google Calendar links are provided.
 * Will need:
 * - Google API credentials (service account or OAuth)
 * - Calendar ID mapping per resource (stored in Resource.metadata.googleCalendarId)
 * - googleapis npm package
 */

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

/**
 * Create a calendar event for a confirmed booking.
 * Placeholder — returns success without actually calling Google API.
 */
export async function createCalendarEvent(
  _resourceId: string,
  event: CalendarEvent
): Promise<CalendarSyncResult> {
  // TODO: Implement with googleapis
  // 1. Get googleCalendarId from Resource.metadata
  // 2. Use google.calendar.events.insert()
  // 3. Store returned eventId in Booking.metadata.googleEventId
  console.log("[GoogleCalendar] Would create event:", event.summary);
  return { success: true, eventId: `placeholder-${Date.now()}` };
}

/**
 * Delete a calendar event when booking is cancelled.
 */
export async function deleteCalendarEvent(
  _resourceId: string,
  _eventId: string
): Promise<CalendarSyncResult> {
  // TODO: Implement with googleapis
  console.log("[GoogleCalendar] Would delete event:", _eventId);
  return { success: true };
}

/**
 * Update a calendar event (e.g., time change).
 */
export async function updateCalendarEvent(
  _resourceId: string,
  _eventId: string,
  event: Partial<CalendarEvent>
): Promise<CalendarSyncResult> {
  // TODO: Implement with googleapis
  console.log("[GoogleCalendar] Would update event:", event.summary);
  return { success: true };
}
