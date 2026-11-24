import type { AgeGroup, Attendance, Category, ChurchEvent, DB, Person } from '../types';

export interface RangeFilter {
  from: string; // inclusive YYYY-MM-DD ('' = no limit)
  to: string; // inclusive
  typeIds: string[]; // [] = all types
}

export function filterEvents(db: DB, f: RangeFilter): ChurchEvent[] {
  return db.Events.filter((e) => (!f.from || e.date >= f.from) && (!f.to || e.date <= f.to) && (!f.typeIds.length || f.typeIds.includes(e.eventTypeId))).sort((a, b) =>
    a.date === b.date ? a.createdAt.localeCompare(b.createdAt) : a.date.localeCompare(b.date),
  );
}

export function attendanceByEvent(db: DB): Map<string, Attendance[]> {
  const m = new Map<string, Attendance[]>();
  for (const a of db.Attendance) {
    if (!m.has(a.eventId)) m.set(a.eventId, []);
    m.get(a.eventId)!.push(a);
  }
  return m;
}

export interface Summary {
  events: number;
  named: number;
  anon: number;
  total: number;
  avg: number;
  unique: number;
  byAge: Record<AgeGroup, { count: number; unique: number }>;
  byCat: Record<Category, { count: number; unique: number }>;
  bySection: Record<string, { count: number; unique: number }>;
  newGuests: number; // distinct people whose first-ever visit was in range
}

export function summarize(db: DB, events: ChurchEvent[]): Summary {
  const byEv = attendanceByEvent(db);
  const ids = new Set(events.map((e) => e.id));
  const rows = db.Attendance.filter((a) => ids.has(a.eventId));
  const uniq = new Set(rows.map((a) => a.personId));
  const mk = () => ({ count: 0, unique: 0 });
  const byAge = { adult: mk(), youth: mk(), kids: mk(), infant: mk() } as Summary['byAge'];
  const byCat = { regular: mk(), non_regular: mk(), returning: mk(), first_time: mk() } as Summary['byCat'];
  const bySection: Summary['bySection'] = { '1': mk(), '2': mk(), '3': mk(), '4': mk(), '': mk() };
  const seenAge = new Map<string, Set<string>>();
  const seenCat = new Map<string, Set<string>>();
  const seenSec = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, id: string) => {
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(id);
  };
  for (const a of rows) {
    const ag = (byAge[a.ageGroup] ? a.ageGroup : 'adult') as AgeGroup;
    const cat = (byCat[a.category] ? a.category : 'regular') as Category;
    const sec = bySection[a.section] ? a.section : '';
    byAge[ag].count++;
    byCat[cat].count++;
    bySection[sec].count++;
    add(seenAge, ag, a.personId);
    add(seenCat, cat, a.personId);
    add(seenSec, sec, a.personId);
  }
  for (const [k, s] of seenAge) byAge[k as AgeGroup].unique = s.size;
  for (const [k, s] of seenCat) byCat[k as Category].unique = s.size;
  for (const [k, s] of seenSec) bySection[k].unique = s.size;
  const anon = events.reduce((n, e) => n + (e.anonCount || 0), 0);
  const firstTimers = new Set(rows.filter((a) => a.category === 'first_time').map((a) => a.personId));
  void byEv;
  return {
    events: events.length,
    named: rows.length,
    anon,
    total: rows.length + anon,
    avg: events.length ? (rows.length + anon) / events.length : 0,
    unique: uniq.size,
    byAge,
    byCat,
    bySection,
    newGuests: firstTimers.size,
  };
}

export interface PersonStat {
  person: Person;
  attended: number;
  possible: number;
  rate: number; // 0..1
  last: string;
  first: string;
}

/**
 * Attendance rate per person over the given events. "Possible" counts only events on/after the
 * person's first visit (or when they were added), so newcomers aren't penalised for weeks before
 * they started coming.
 */
export function personStats(db: DB, events: ChurchEvent[]): PersonStat[] {
  const evIds = new Set(events.map((e) => e.id));
  const evDate = new Map(db.Events.map((e) => [e.id, e.date]));
  const attended = new Map<string, string[]>();
  const firstEver = new Map<string, string>();
  for (const a of db.Attendance) {
    const d = evDate.get(a.eventId);
    if (!d) continue;
    const f = firstEver.get(a.personId);
    if (!f || d < f) firstEver.set(a.personId, d);
    if (!evIds.has(a.eventId)) continue;
    if (!attended.has(a.personId)) attended.set(a.personId, []);
    attended.get(a.personId)!.push(d);
  }
  return db.People.map((p) => {
    const ds = (attended.get(p.id) ?? []).sort();
    const start = [p.firstVisit, firstEver.get(p.id)].filter(Boolean).sort()[0] || (p.category === 'regular' ? '' : p.createdAt.slice(0, 10));
    const possible = events.filter((e) => !start || e.date >= start).length;
    return {
      person: p,
      attended: ds.length,
      possible: Math.max(possible, ds.length),
      rate: possible ? ds.length / Math.max(possible, ds.length) : 0,
      last: lastAttended(db, p.id),
      first: firstEver.get(p.id) ?? '',
    };
  });
}

export function lastAttended(db: DB, personId: string): string {
  const evDate = new Map(db.Events.map((e) => [e.id, e.date]));
  let last = '';
  for (const a of db.Attendance) if (a.personId === personId) {
    const d = evDate.get(a.eventId) ?? '';
    if (d > last) last = d;
  }
  return last;
}

export interface Absentee {
  person: Person;
  missed: number; // consecutive recent events missed
  last: string;
}

/** Regular, active attendees who missed each of the most recent `n` events of the given types. */
export function absentees(db: DB, typeIds: string[], n: number, asOf: string): Absentee[] {
  const evs = db.Events.filter((e) => (!typeIds.length || typeIds.includes(e.eventTypeId)) && e.date <= asOf).sort((a, b) => b.date.localeCompare(a.date));
  if (evs.length < n) return [];
  const byEv = attendanceByEvent(db);
  const present = evs.map((e) => new Set((byEv.get(e.id) ?? []).map((a) => a.personId)));
  const out: Absentee[] = [];
  for (const p of db.People) {
    if (p.status !== 'active' || p.category !== 'regular') continue;
    let missed = 0;
    while (missed < evs.length && !present[missed].has(p.id)) missed++;
    if (missed >= n) out.push({ person: p, missed: missed === evs.length ? evs.length : missed, last: lastAttended(db, p.id) });
  }
  return out.sort((a, b) => b.missed - a.missed || (a.last || '').localeCompare(b.last || ''));
}

export function monthKey(date: string) {
  return date.slice(0, 7);
}
