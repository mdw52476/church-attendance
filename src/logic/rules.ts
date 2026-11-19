import type { AgeGroup, Attendance, Category, ChurchEvent, Person } from '../types';
import { addMonths, parseDate, todayStr } from '../util';

/**
 * Age group from birthdate, using the US school-year cutoff (Sept 1):
 *   Infant: under 3
 *   Kids:   age 3 through 5th grade (Pre-K – 5th)
 *   Youth:  6th – 12th grade
 *   Adult:  graduated
 */
export function ageGroupFromBirthdate(birthdate: string, on = todayStr()): AgeGroup | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return null;
  const b = parseDate(birthdate);
  const now = parseDate(on);
  const ageNow = yearsBetween(b, now);
  if (ageNow < 3) return 'infant';
  // Age on Sept 1 at the start of the current school year
  const syStartYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1; // Aug or later → new school year
  const ageAtCutoff = yearsBetween(b, new Date(syStartYear, 8, 1));
  const grade = ageAtCutoff - 5; // K = 0
  if (grade <= 5) return 'kids';
  if (grade <= 12) return 'youth';
  return 'adult';
}

/** School grade label from birthdate, for display. */
export function gradeFromBirthdate(birthdate: string, on = todayStr()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return '';
  const now = parseDate(on);
  const syStartYear = now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1;
  const g = yearsBetween(parseDate(birthdate), new Date(syStartYear, 8, 1)) - 5;
  if (g < -2) return '';
  if (g < 0) return 'Pre-K';
  if (g === 0) return 'K';
  if (g <= 12) return ordinal(g) + ' grade';
  return '';
}

export function ageYears(birthdate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return null;
  return yearsBetween(parseDate(birthdate), new Date());
}

function yearsBetween(a: Date, b: Date) {
  let y = b.getFullYear() - a.getFullYear();
  if (b.getMonth() < a.getMonth() || (b.getMonth() === a.getMonth() && b.getDate() < a.getDate())) y--;
  return y;
}

function ordinal(n: number) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const REGULAR_AFTER_MONTHS = 6;

/**
 * Category rules (only ever move "up", never down, and never touch people set manually):
 *   1 visit                         → First-time guest
 *   2+ visits                       → Returning guest
 *   attending 6+ months after first → Regular
 */
export function computeCategory(p: Person, visitDates: string[]): Category {
  if (p.categoryManual || p.category === 'regular') return p.category;
  if (visitDates.length === 0) return p.category;
  const sorted = [...visitDates].sort();
  const first = p.firstVisit && p.firstVisit < sorted[0] ? p.firstVisit : sorted[0];
  const last = sorted[sorted.length - 1];
  if (sorted.length >= 2 && last >= addMonths(first, REGULAR_AFTER_MONTHS)) return 'regular';
  if (sorted.length >= 2 || p.category === 'returning') return 'returning';
  return 'first_time';
}

/** Re-applies automatic rules to everyone. Returns only the people that changed. */
export function applyAutoRules(people: Person[], events: ChurchEvent[], attendance: Attendance[]): Person[] {
  const eventDate = new Map(events.map((e) => [e.id, e.date]));
  const visits = new Map<string, Set<string>>();
  for (const a of attendance) {
    const d = eventDate.get(a.eventId);
    if (!d) continue;
    if (!visits.has(a.personId)) visits.set(a.personId, new Set());
    visits.get(a.personId)!.add(d); // count distinct days, not events
  }
  const changed: Person[] = [];
  for (const p of people) {
    const dates = [...(visits.get(p.id) ?? [])].sort();
    let next = p;
    const firstVisit = dates[0] && (!p.firstVisit || dates[0] < p.firstVisit) ? dates[0] : p.firstVisit;
    if (firstVisit !== p.firstVisit) next = { ...next, firstVisit };
    const cat = computeCategory(next, dates);
    if (cat !== next.category) next = { ...next, category: cat };
    if (!p.ageGroupManual && p.birthdate) {
      const ag = ageGroupFromBirthdate(p.birthdate);
      if (ag && ag !== next.ageGroup) next = { ...next, ageGroup: ag };
    }
    if (next !== p) changed.push(next);
  }
  return changed;
}
