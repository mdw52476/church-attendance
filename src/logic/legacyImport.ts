// Importer for the church's original attendance spreadsheet layout:
//   row 1:   [ , , , <special col e.g. "Fr-Giving">, 11/15/26, 11/8/26, ... ]
//   rows 2+: summary rows ("TOTAL NUMBER:", "Kids", ...) with A = "0"
//   section header rows: A empty, B = section title ("Regular Attendees", ...)
//   person rows: A = TRUE/FALSE, B = name ("Last, First (note)"), C = tag, then one mark per date
// A mark is any non-empty cell other than FALSE/0 (TRUE, X, 1, 2…).

import type { AgeGroup, Attendance, Category, ChurchEvent, Family, FamilyMember, Person } from '../types';
import { newPerson } from '../data/store';
import { nowIso, parseDate, todayStr, uid } from '../util';

export interface LegacyColumn {
  index: number;
  header: string;
  kind: 'date' | 'special';
  date: string; // YYYY-MM-DD ('' for a special column until the user picks one)
  originalDate?: string; // set when a Monday/Saturday date was moved to Sunday
  total: number; // from the "TOTAL" row, 0 if none
}

export interface LegacyLayout {
  headerRow: number;
  totalRow: number;
  columns: LegacyColumn[];
}

export interface SpecialChoice {
  include: boolean;
  name: string;
  date: string;
}

export interface LegacyOptions {
  specials: Record<number, SpecialChoice>;
  sundayTypeId: string;
  specialTypeId: string;
  existingPeople: Person[];
  existingEvents: ChurchEvent[];
}

export interface LegacyResult {
  newPeople: Person[];
  matchedExisting: number;
  families: Family[];
  members: FamilyMember[];
  events: ChurchEvent[];
  attendance: Attendance[];
  anonymousTotal: number;
  placeholders: string[]; // names imported as descriptions
  merged: string[]; // duplicate rows combined into one person
  skippedEvents: string[];
  notes: string[];
  activeCount: number;
  inactiveCount: number;
}

const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;

function parseSheetDate(s: string): string {
  const m = s.trim().match(DATE_RE);
  if (!m) return '';
  let y = Number(m[3]);
  if (y < 100) y += 2000;
  return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

const isMark = (v: string | undefined) => {
  const s = (v ?? '').trim();
  return s !== '' && !/^(false|0|no)$/i.test(s);
};

export function detectLayout(values: string[][]): LegacyLayout | null {
  let headerRow = -1;
  for (let r = 0; r < Math.min(values.length, 12); r++) {
    if ((values[r] || []).filter((c) => DATE_RE.test(String(c).trim())).length >= 3) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) return null;
  const header = values[headerRow];
  let totalRow = -1;
  for (let r = headerRow + 1; r < Math.min(values.length, headerRow + 12); r++) {
    if ((values[r] || []).slice(0, 4).some((c) => /total/i.test(String(c)))) {
      totalRow = r;
      break;
    }
  }
  const columns: LegacyColumn[] = [];
  for (let c = 3; c < header.length; c++) {
    const h = String(header[c] ?? '').trim();
    if (!h) continue;
    const total = totalRow >= 0 ? Number(String(values[totalRow][c] ?? '').replace(/[^\d]/g, '')) || 0 : 0;
    let date = parseSheetDate(h);
    if (date) {
      const dow = parseDate(date).getDay();
      let originalDate: string | undefined;
      if (dow === 1 || dow === 6) {
        // Sunday service recorded on a Monday/Saturday: snap to the Sunday
        const d = parseDate(date);
        d.setDate(d.getDate() + (dow === 1 ? -1 : 1));
        originalDate = date;
        date = todayStr(d);
      }
      columns.push({ index: c, header: h, kind: 'date', date, originalDate, total });
    } else {
      columns.push({ index: c, header: h, kind: 'special', date: '', total });
    }
  }
  return { headerRow, totalRow, columns };
}

// ---------- names ----------

const PLACEHOLDER =
  /\b(guests?|kids?|child(ren)?|boy|girl|man|woman|lady|family|fam|friends?|mom|dad|mother|father|sister|brother|son|daughter|grand(son|daughter|ma|pa|kids|parents)|gma|gpa|husband|wife|cousin|neighbor|relative|boyfriend|girlfriend|gf|roommate|uncle|aunt|nephew|niece|step(sister|dad|mom)|parents|group|older|mystery|person|people|couple|someone|baby|other|and|with|from|sitting|member|bil|guy|know)\b/i;

function looksPlaceholder(s: string) {
  return !s || PLACEHOLDER.test(s) || /\d|\?|['’]s\b/.test(s);
}

export interface ParsedName {
  first: string;
  last: string;
  description: string;
  named: boolean; // has a real first name
}

export function parseName(raw: string): ParsedName {
  const clean = raw.replace(/\s+/g, ' ').trim();
  const parens = [...clean.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim()).filter((p) => p && !/^youth$/i.test(p));
  const rest = clean.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const note = parens.join('; ');

  if (rest.includes(',')) {
    const [a, ...b] = rest.split(',');
    const last = a.replace(/\?/g, '').trim();
    const first = b.join(',').trim();
    if (looksPlaceholder(last) && last) return { first: '', last: '', description: clean, named: false };
    if (looksPlaceholder(first)) return { first: '', last, description: clean, named: false };
    return { first, last, description: note, named: true };
  }
  if (!rest || looksPlaceholder(rest)) return { first: '', last: '', description: clean, named: false };
  const words = rest.split(' ');
  if (words.length === 1) return { first: words[0], last: '', description: note, named: true };
  if (words.length === 2) return { first: words[0], last: words[1], description: note, named: true };
  return { first: '', last: '', description: clean, named: false };
}

function ageFromTag(tag: string, text: string): AgeGroup | null {
  const t = tag.toLowerCase();
  if (/baby|infant|nursery/.test(t)) return 'infant';
  if (/kid|pre-?k|child/.test(t)) return 'kids';
  if (/youth/.test(t)) return 'youth';
  if (/adult/.test(t)) return 'adult';
  const x = text.toLowerCase();
  if (/\(youth\)|\byouth\b/.test(x)) return 'youth';
  if (/\bbaby\b/.test(x)) return 'infant';
  if (/\b(kid|child)\b/.test(x)) return 'kids';
  return null;
}

const catRank: Record<Category, number> = { first_time: 0, returning: 1, non_regular: 2, regular: 3 };

// ---------- build ----------

interface Row {
  raw: string;
  tag: string;
  section: string;
  name: ParsedName;
  dates: string[]; // event keys this row is marked on
}

export function buildLegacy(values: string[][], layout: LegacyLayout, opts: LegacyOptions): LegacyResult {
  const notes: string[] = [];
  const placeholders: string[] = [];
  const merged: string[] = [];
  const skippedEvents: string[] = [];

  // usable columns -> event keys
  const cols = layout.columns
    .map((c) => {
      if (c.kind === 'date') return { ...c, typeId: opts.sundayTypeId, name: '', key: `${opts.sundayTypeId}|${c.date}` };
      const s = opts.specials[c.index];
      if (!s?.include || !s.date) return null;
      return { ...c, date: s.date, typeId: opts.specialTypeId, name: s.name.trim() || c.header, key: `${opts.specialTypeId}|${s.date}|${s.name}` };
    })
    .filter((c): c is NonNullable<typeof c> => !!c);
  for (const c of layout.columns) if (c.originalDate) notes.push(`${c.header} is not a Sunday, so it was recorded as Sunday ${c.date}.`);

  // ---- rows ----
  const rows: Row[] = [];
  let section = '';
  for (let r = layout.headerRow + 1; r < values.length; r++) {
    const row = values[r] || [];
    const a = String(row[0] ?? '').trim();
    const b = String(row[1] ?? '').trim();
    const c = String(row[2] ?? '').trim();
    if (!b) continue;
    if (!a && !c) {
      section = b;
      continue;
    }
    if (!/^(true|false)$/i.test(a)) continue; // summary rows
    rows.push({ raw: b, tag: c, section, name: parseName(b), dates: cols.filter((col) => isMark(row[col.index])).map((col) => col.key) });
  }

  // ---- people (merge duplicates by first+last, and match existing app people) ----
  const existingByName = new Map<string, Person>();
  for (const p of opts.existingPeople) if (p.firstName && p.lastName) existingByName.set(`${p.firstName} ${p.lastName}`.toLowerCase(), p);
  const byKey = new Map<string, { person: Person; existing: boolean; visits: Set<string>; firstTimeTag: boolean }>();
  const rowPerson: string[] = [];
  const colDate = new Map(cols.map((c) => [c.key, c.date]));

  for (const row of rows) {
    const n = row.name;
    const key = n.named && n.last ? `${n.first} ${n.last}`.toLowerCase() : `__row${rowPerson.length}`;
    const visits = new Set(row.dates);
    const isRegularSection = /^\W*regular/i.test(row.section) && !/non-?regular/i.test(row.section);
    const tag = row.tag.toLowerCase();
    let category: Category;
    if (/1st|first/.test(tag)) category = visits.size >= 2 ? 'returning' : 'first_time';
    else if (/return/.test(tag)) category = 'returning';
    else if (isRegularSection) category = 'regular';
    else if (/non-?regular/i.test(row.section)) category = 'non_regular';
    else if (/guest/i.test(row.section) && !/return/i.test(row.section) && visits.size <= 1) category = 'first_time';
    else category = 'returning';
    // unnamed placeholders stay on the check-in list only when they're part of a regular family
    const inactive = /one time|past/i.test(row.section) || /non-?return/.test(tag) || (!n.named && !isRegularSection);
    const age = ageFromTag(row.tag, row.raw);
    if (!n.named) placeholders.push(row.raw);

    const prev = byKey.get(key);
    if (prev) {
      merged.push(row.raw);
      row.dates.forEach((d) => prev.visits.add(d));
      const p = prev.person;
      if (catRank[category] > catRank[p.category]) p.category = category;
      if (!inactive) p.status = 'active';
      if (age && !p.ageGroupManual) {
        p.ageGroup = age;
        p.ageGroupManual = true;
      }
      if (n.description && !p.description.includes(n.description)) p.description = [p.description, n.description].filter(Boolean).join('; ');
      rowPerson.push(p.id);
      continue;
    }
    const ex = existingByName.get(key);
    if (ex) {
      byKey.set(key, { person: ex, existing: true, visits, firstTimeTag: false });
      rowPerson.push(ex.id);
      continue;
    }
    const p = newPerson({
      firstName: n.first,
      lastName: n.last,
      description: n.description,
      category,
      ageGroup: age ?? 'adult',
      ageGroupManual: !!age, // tag came from the sheet; keep it until a birthdate is added
      status: inactive ? 'inactive' : 'active',
      followUp: '',
      notes: row.section ? `Imported from "${row.section}"` : '',
    });
    byKey.set(key, { person: p, existing: false, visits, firstTimeTag: /1st|first/.test(tag) || (/guest/i.test(row.section) && !/return/.test(tag)) });
    rowPerson.push(p.id);
  }
  // age tags from the sheet are just tags, not locks — leave auto rules free once a birthdate exists
  for (const { person } of byKey.values()) if (person.ageGroupManual && !person.birthdate) person.ageGroupManual = false;

  const entries = [...byKey.values()];
  for (const e of entries) {
    const ds = [...e.visits].map((k) => colDate.get(k)!).sort();
    if (!e.existing && ds[0]) e.person.firstVisit = ds[0];
    // rows combined from two sections: two visits means they've returned
    if (!e.existing && e.person.category === 'first_time' && new Set(ds).size >= 2) e.person.category = 'returning';
  }

  // ---- families: consecutive rows sharing a last name within a section ----
  const families: Family[] = [];
  const members: FamilyMember[] = [];
  const peopleById = new Map(entries.map((e) => [e.person.id, e.person]));
  let group: { key: string; section: string; ids: string[]; name: string } | null = null;
  const closeGroup = () => {
    if (!group) return;
    const ids = [...new Set(group.ids)];
    if (ids.length >= 2) {
      const ps = ids.map((id) => peopleById.get(id)!);
      const primary = ps.find((p) => p.ageGroup === 'adult' && p.firstName) ?? ps.find((p) => p.firstName);
      const f: Family = { id: uid('f'), name: group.name, primaryAdultId: primary?.id ?? '', notes: '' };
      families.push(f);
      ids.forEach((personId) => members.push({ id: uid('fm'), familyId: f.id, personId }));
    }
    group = null;
  };
  rows.forEach((row, i) => {
    const last = row.name.last;
    const key = last.toLowerCase();
    if (key && group && group.key === key && group.section === row.section) {
      group.ids.push(rowPerson[i]);
      return;
    }
    // "Gingrich son" directly under "Gingrich, Titus" joins that family
    const firstWord = row.raw.split(/[\s,]+/)[0].toLowerCase();
    if (!key && group && group.key === firstWord && group.section === row.section) {
      group.ids.push(rowPerson[i]);
      return;
    }
    closeGroup();
    if (key && row.name.named) group = { key, section: row.section, ids: [rowPerson[i]], name: last.charAt(0).toUpperCase() + last.slice(1) };
  });
  closeGroup();

  // ---- events ----
  const existingEv = new Set(opts.existingEvents.map((e) => `${e.eventTypeId}|${e.date}${e.name ? '|' + e.name : ''}`));
  const events: ChurchEvent[] = [];
  const eventIdByKey = new Map<string, string>();
  const namedCount = new Map<string, number>();
  for (const e of entries) for (const k of e.visits) namedCount.set(k, (namedCount.get(k) ?? 0) + 1);
  let anonymousTotal = 0;
  const ts = nowIso();
  for (const c of cols) {
    if (eventIdByKey.has(c.key)) continue;
    const probe = c.kind === 'special' ? `${c.typeId}|${c.date}|${c.name}` : `${c.typeId}|${c.date}`;
    if (existingEv.has(probe)) {
      skippedEvents.push(`${c.name || 'Sunday'} ${c.date}`);
      continue;
    }
    const named = namedCount.get(c.key) ?? 0;
    if (!named && !c.total) continue;
    const anon = Math.max(0, c.total - named);
    anonymousTotal += anon;
    const ev: ChurchEvent = {
      id: uid('e'),
      eventTypeId: c.typeId,
      date: c.date,
      name: c.kind === 'special' ? c.name : '',
      anonCount: anon,
      anonNotes: anon ? 'From the old attendance sheet total' : '',
      notes: 'Imported from the old attendance sheet',
      createdBy: 'import',
      createdAt: ts,
      updatedBy: '',
      updatedAt: '',
    };
    events.push(ev);
    eventIdByKey.set(c.key, ev.id);
  }

  // ---- attendance (category snapshot: first visit as first-time guest, then returning) ----
  const attendance: Attendance[] = [];
  for (const e of entries) {
    const p = e.person;
    const keys = [...e.visits].filter((k) => eventIdByKey.has(k)).sort((a, b) => colDate.get(a)!.localeCompare(colDate.get(b)!));
    keys.forEach((k, i) => {
      const cat: Category =
        p.category === 'regular' || p.category === 'non_regular' ? p.category : e.firstTimeTag && i === 0 ? 'first_time' : 'returning';
      const name = p.firstName || p.lastName ? [p.firstName, p.lastName].filter(Boolean).join(' ') : p.description;
      attendance.push({
        id: uid('a'),
        eventId: eventIdByKey.get(k)!,
        personId: p.id,
        personName: name,
        category: cat,
        ageGroup: p.ageGroup,
        section: p.section,
        checkedInBy: 'import',
        checkedInAt: colDate.get(k)! + 'T12:00:00.000Z',
      });
    });
  }

  const newPeople = entries.filter((e) => !e.existing).map((e) => e.person);
  return {
    newPeople,
    matchedExisting: entries.filter((e) => e.existing).length,
    families,
    members,
    events,
    attendance,
    anonymousTotal,
    placeholders,
    merged,
    skippedEvents,
    notes,
    activeCount: newPeople.filter((p) => p.status === 'active').length,
    inactiveCount: newPeople.filter((p) => p.status === 'inactive').length,
  };
}
