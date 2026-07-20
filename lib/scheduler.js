// ──────────────────────────────────────────────────────────────────────────────
// Priority-aware appointment scheduling.
//
// Rules (as specified):
//   - Critical and High both try the first genuinely free gap in the calendar.
//   - If the day is full, Critical and High may "bump" an existing IT-ticket
//     appointment, but ONLY one booked at Medium or Low priority — never each
//     other, and never anything that isn't one of our own ticket bookings (real
//     meetings, lunch, personal events are never touched).
//   - Medium and Low never bump anything; they just take the first free gap,
//     rolling to a later day if today has none.
//   - A bumped ticket is rescheduled fresh (its own search, no bump power of its
//     own since it's Medium/Low) — the caller is responsible for re-running the
//     scheduler for it starting from where it was bumped.
//
// This module is pure logic — no Blob, no HTTP, no Graph calls — so it can be
// unit-tested directly against real calendar data (see the test harness used to
// verify this file) before anything is wired to a live calendar. The caller
// (api/*.js) is responsible for fetching events and creating/moving the actual
// calendar entries.
// ──────────────────────────────────────────────────────────────────────────────

const PRIORITY_RANK = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const BUMP_TARGETS  = new Set(['Medium', 'Low']);   // who CAN be bumped
const BUMPERS       = new Set(['Critical', 'High']); // who CAN bump

// Ticket-booking events are tagged in their subject, e.g. "[IT-2026-12345]
// Hardware - PC / Laptop / Desktop (High)" — see buildEventSubject(). Detecting
// this from the subject (rather than needing a separate calendar property)
// means no extra round-trip to look up what an event "is".
const SUBJECT_RE = /^\[(IT-\d{4}-\d+)\][^(]*\(([A-Za-z]+)\)\s*$/;

function buildEventSubject(ticketID, category, priority) {
  return `[${ticketID}] ${category} (${priority})`;
}

function parseEventSubject(subject) {
  const m = SUBJECT_RE.exec(String(subject || '').trim());
  return m ? { ticketID: m[1], priority: m[2] } : null;
}

function isItTicketEvent(event) {
  return !!parseEventSubject(event.subject);
}

function toMs(iso) { return new Date(iso).getTime(); }

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * First gap in `windowStart`..`windowEnd` (ISO strings) at least `minutes` long,
 * considering ALL given events (busy is busy, regardless of whose event it is).
 * Returns { start, end } (ISO strings) or null if no gap exists in the window.
 */
function findFirstFreeGap(events, minutes, windowStart, windowEnd) {
  const durMs = minutes * 60000;
  const winStartMs = toMs(windowStart);
  const winEndMs   = toMs(windowEnd);

  const busy = events
    .map(e => ({ start: toMs(e.startWithTimeZone || e.start), end: toMs(e.endWithTimeZone || e.end) }))
    .filter(e => e.end > winStartMs && e.start < winEndMs) // only events touching the window
    .sort((a, b) => a.start - b.start);

  let cursor = winStartMs;
  for (const b of busy) {
    if (b.start - cursor >= durMs) {
      return { start: new Date(cursor).toISOString(), end: new Date(cursor + durMs).toISOString() };
    }
    if (b.end > cursor) cursor = b.end; // skip past this busy block (handles overlapping events too)
  }
  if (winEndMs - cursor >= durMs) {
    return { start: new Date(cursor).toISOString(), end: new Date(cursor + durMs).toISOString() };
  }
  return null;
}

/**
 * Among `events`, pick the best Medium/Low IT-ticket booking to bump: lowest
 * priority first (bump a Low before a Medium), then earliest start (freeing the
 * earliest possible slot serves "ASAP" — the point of bumping at all).
 * Returns { event, ticketID, priority } or null if nothing is bumpable.
 */
function pickBumpVictim(events) {
  const candidates = events
    .map(e => ({ event: e, meta: parseEventSubject(e.subject) }))
    .filter(x => x.meta && BUMP_TARGETS.has(x.meta.priority));

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const rankDiff = PRIORITY_RANK[b.meta.priority] - PRIORITY_RANK[a.meta.priority]; // Low (3) before Medium (2)
    if (rankDiff !== 0) return rankDiff;
    return toMs(a.event.startWithTimeZone || a.event.start) - toMs(b.event.startWithTimeZone || b.event.start);
  });

  const chosen = candidates[0];
  return { event: chosen.event, ticketID: chosen.meta.ticketID, priority: chosen.meta.priority };
}

/**
 * Attempts to schedule one ticket against one day's events.
 *
 * @param {string} priority     Critical | High | Medium | Low
 * @param {number} minutes      estimated duration
 * @param {Array}  events       this day's calendar events (both IT-ticket and
 *                               other), each with subject/start/end (or
 *                               startWithTimeZone/endWithTimeZone)
 * @param {string} windowStart  ISO — business day start (e.g. 06:00Z = 8am SAST)
 * @param {string} windowEnd    ISO — business day end
 * @returns {{ slot: {start,end}, bumped: {ticketID,priority,oldSlot}|null } | null}
 *          null means: no slot available this day, caller should try the next day.
 */
function scheduleForDay(priority, minutes, events, windowStart, windowEnd) {
  const freeGap = findFirstFreeGap(events, minutes, windowStart, windowEnd);
  if (freeGap) return { slot: freeGap, bumped: null };

  if (!BUMPERS.has(priority)) return null; // Medium/Low never bump — try tomorrow

  const victim = pickBumpVictim(events);
  if (!victim) return null; // nothing bumpable today — try tomorrow

  const oldSlot = {
    start: victim.event.startWithTimeZone || victim.event.start,
    end:   victim.event.endWithTimeZone   || victim.event.end
  };
  // The new ticket takes the victim's old START time, for its OWN duration —
  // not necessarily the victim's old duration (a bumped 4-hour job and a
  // 10-minute Critical ticket don't need to occupy the same amount of time).
  const newSlot = {
    start: oldSlot.start,
    end:   new Date(toMs(oldSlot.start) + minutes * 60000).toISOString()
  };

  return {
    slot: newSlot,
    bumped: { ticketID: victim.ticketID, priority: victim.priority, eventId: victim.event.id, oldSlot }
  };
}

const BUSINESS_START_HOUR = 6;  // 06:00 UTC == 08:00 SAST
const BUSINESS_END_HOUR   = 15; // 15:00 UTC == 17:00 SAST

function isWeekend(dateOnlyIso) {
  const day = new Date(dateOnlyIso + 'T00:00:00Z').getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

function dayWindow(dateOnlyIso) {
  const pad = n => String(n).padStart(2, '0');
  return {
    start: `${dateOnlyIso}T${pad(BUSINESS_START_HOUR)}:00:00Z`,
    end:   `${dateOnlyIso}T${pad(BUSINESS_END_HOUR)}:00:00Z`
  };
}

function addDaysIso(fromDateIso, days) {
  const d = new Date(fromDateIso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function minutesBetween(slot) {
  return Math.round((toMs(slot.end) - toMs(slot.start)) / 60000);
}

/**
 * Finds a slot for a ticket across multiple business days (weekends skipped),
 * and if a Critical/High ticket needs to bump a Medium/Low booking, also finds
 * the bumped ticket a fresh slot of its own (searching forward from the same
 * day, since Medium/Low never bump anything themselves — recursion always
 * terminates after at most one bump-cascade).
 *
 * @param {string} priority      Critical | High | Medium | Low
 * @param {number} minutes       estimated duration
 * @param {Array}  events        ALL events across the whole search window
 * @param {string} fromDateIso   yyyy-MM-dd — first day to consider
 * @param {number} maxDays       safety cap on how many business days to search
 * @returns {{slot, bumped: null|{ticketID,priority,eventId,oldSlot,newSlot}}|null}
 *          null means nothing found within maxDays.
 */
function scheduleTicket(priority, minutes, events, fromDateIso, maxDays = 10) {
  for (let offset = 0; offset < maxDays; offset++) {
    const dateIso = addDaysIso(fromDateIso, offset);
    if (isWeekend(dateIso)) continue;

    const { start: windowStart, end: windowEnd } = dayWindow(dateIso);
    const winStartMs = toMs(windowStart), winEndMs = toMs(windowEnd);
    const dayEvents = events.filter(e => {
      const s = toMs(e.startWithTimeZone || e.start), en = toMs(e.endWithTimeZone || e.end);
      return en > winStartMs && s < winEndMs;
    });

    const result = scheduleForDay(priority, minutes, dayEvents, windowStart, windowEnd);
    if (!result) continue;
    if (!result.bumped) return result;

    // Cascade: give the bumped ticket a fresh slot. Remove its own (now-vacated)
    // event from consideration and add the new ticket's just-assigned slot as
    // busy, then search forward from the same day.
    const victimEvents = events
      .filter(e => parseEventSubject(e.subject)?.ticketID !== result.bumped.ticketID)
      .concat([{ subject: buildEventSubject('__reserved__', '', priority), start: result.slot.start, end: result.slot.end }]);

    const victimResult = scheduleTicket(
      result.bumped.priority,
      minutesBetween(result.bumped.oldSlot),
      victimEvents,
      dateIso,
      maxDays - offset
    );

    return {
      slot: result.slot,
      bumped: { ...result.bumped, newSlot: victimResult ? victimResult.slot : null }
    };
  }
  return null;
}

module.exports = {
  PRIORITY_RANK, BUMP_TARGETS, BUMPERS,
  buildEventSubject, parseEventSubject, isItTicketEvent,
  findFirstFreeGap, pickBumpVictim, scheduleForDay,
  isWeekend, dayWindow, addDaysIso, scheduleTicket
};
