import type { Backend } from './backend';
import { TABLES, toRaw, type RawRow, type TableName } from './schema';
import type { AgeGroup, Attendance, Category, ChurchEvent, Family, FamilyMember, Person } from '../types';
import { addDays, nowIso, todayStr, uid } from '../util';
import { defaultEventTypes } from './defaults';

const LS = 'ca.demo';

export class DemoBackend implements Backend {
  kind = 'demo' as const;
  private data: Record<TableName, RawRow[]>;

  constructor() {
    let d: Record<TableName, RawRow[]> | null = null;
    try {
      d = JSON.parse(localStorage.getItem(LS) || 'null');
    } catch {
      d = null;
    }
    this.data = d || seed();
    for (const t of TABLES) this.data[t] ||= [];
    this.save();
  }

  static reset() {
    localStorage.removeItem(LS);
  }

  userEmail() {
    return 'demo@example.com';
  }

  private save() {
    localStorage.setItem(LS, JSON.stringify(this.data));
  }

  async init() {}

  async loadAll() {
    return JSON.parse(JSON.stringify(this.data));
  }

  async upsert(table: TableName, rows: RawRow[]) {
    const list = this.data[table];
    for (const r of rows) {
      const i = list.findIndex((x) => x.id === r.id);
      if (i >= 0) list[i] = { ...list[i], ...r };
      else list.push(r);
    }
    this.save();
  }

  async remove(table: TableName, ids: string[]) {
    const s = new Set(ids);
    this.data[table] = this.data[table].filter((r) => !s.has(r.id));
    this.save();
  }
}

// ---------- sample data ----------

const LAST = ['Anderson', 'Brooks', 'Carter', 'Diaz', 'Evans', 'Foster', 'Garcia', 'Hughes', 'Iverson', 'Johnson', 'Kim', 'Lopez', 'Miller', 'Nguyen', 'Owens', 'Patel', 'Reed', 'Smith', 'Turner', 'Walker'];
const ADULT_M = ['James', 'Michael', 'David', 'Robert', 'Daniel', 'Chris', 'Mark', 'Paul', 'Steven', 'Kevin'];
const ADULT_F = ['Mary', 'Sarah', 'Jennifer', 'Lisa', 'Karen', 'Emily', 'Rachel', 'Laura', 'Amy', 'Grace'];
const KIDS = ['Noah', 'Emma', 'Liam', 'Ava', 'Mason', 'Mia', 'Ethan', 'Lily', 'Lucas', 'Zoe', 'Caleb', 'Ella', 'Owen', 'Chloe', 'Eli', 'Hannah'];

function rnd<T>(a: T[], i: number) {
  return a[i % a.length];
}

function bdayYearsAgo(y: number, i: number) {
  const d = new Date();
  d.setFullYear(d.getFullYear() - y);
  d.setDate(d.getDate() - ((i * 37) % 300));
  return todayStr(d);
}

function seed(): Record<TableName, RawRow[]> {
  const people: Person[] = [];
  const families: Family[] = [];
  const members: FamilyMember[] = [];
  const ts = nowIso();
  const mk = (first: string, last: string, ageGroup: AgeGroup, birthdate: string, section: string, category: Category = 'regular'): Person => ({
    id: uid('p'),
    firstName: first,
    lastName: last,
    description: '',
    category,
    categoryManual: false,
    ageGroup,
    ageGroupManual: false,
    birthdate,
    section,
    phone: '',
    email: '',
    address: '',
    notes: '',
    followUp: category === 'regular' ? '' : 'needed',
    followUpNotes: '',
    status: 'active',
    firstVisit: '',
    createdAt: ts,
    updatedAt: ts,
  });

  for (let i = 0; i < 18; i++) {
    const last = LAST[i];
    const section = String((i % 4) + 1);
    const fam: Family = { id: uid('f'), name: last, primaryAdultId: '', notes: '' };
    const dad = mk(rnd(ADULT_M, i), last, 'adult', bdayYearsAgo(32 + (i % 20), i), section);
    dad.phone = `555-01${String(i).padStart(2, '0')}`;
    const fmembers = [dad];
    if (i % 5 !== 4) fmembers.push(mk(rnd(ADULT_F, i), last, 'adult', bdayYearsAgo(30 + (i % 18), i + 3), section));
    const kids = i % 3;
    for (let k = 0; k < kids + (i % 4 === 0 ? 1 : 0); k++) {
      const age = [1, 4, 7, 10, 13, 16][(i + k * 2) % 6];
      const ag: AgeGroup = age < 3 ? 'infant' : age < 11 ? 'kids' : 'youth';
      fmembers.push(mk(rnd(KIDS, i * 2 + k), last, ag, bdayYearsAgo(age, i + k), section));
    }
    fam.primaryAdultId = dad.id;
    families.push(fam);
    for (const p of fmembers) {
      people.push(p);
      members.push({ id: uid('fm'), familyId: fam.id, personId: p.id });
    }
  }
  // a few singles and guests
  people.push(mk('Ruth', 'Bell', 'adult', bdayYearsAgo(78, 1), '2'));
  people.push(mk('Tom', 'Hayes', 'adult', bdayYearsAgo(66, 2), '3'));
  people.push(mk('Jordan', 'Price', 'youth', bdayYearsAgo(15, 3), '4'));
  const g1 = mk('Alicia', 'Moreno', 'adult', '', '1', 'returning');
  const g2 = mk('', '', 'adult', '', '2', 'first_time');
  g2.description = 'Older man, red jacket, sat with the Reeds';
  people.push(g1, g2);
  const inactive = mk('Frank', 'Moss', 'adult', '', '3');
  inactive.status = 'inactive';
  people.push(inactive);

  const types = defaultEventTypes();
  const sunday = types.find((t) => t.kind === 'sunday')!;
  const youth = types.find((t) => t.kind === 'youth')!;
  const events: ChurchEvent[] = [];
  const attendance: Attendance[] = [];

  // last Sunday on or before today
  const today = new Date();
  const lastSun = todayStr(new Date(today.getFullYear(), today.getMonth(), today.getDate() - today.getDay()));
  const active = people.filter((p) => p.status === 'active' && p.category === 'regular');
  for (let w = 16; w >= 1; w--) {
    const date = addDays(lastSun, -7 * (w - 1));
    const ev: ChurchEvent = { id: uid('e'), eventTypeId: sunday.id, date, name: '', anonCount: (w * 3) % 5, anonNotes: '', notes: '', createdBy: 'demo@example.com', createdAt: ts, updatedBy: '', updatedAt: '' };
    events.push(ev);
    active.forEach((p, i) => {
      // some families stop coming in recent weeks (shows up in absentee report)
      const dropped = (i % 11 === 0 && w <= 4) || (i * 7 + w) % 6 === 0;
      if (dropped) return;
      attendance.push({ id: uid('a'), eventId: ev.id, personId: p.id, personName: `${p.firstName} ${p.lastName}`, category: p.category, ageGroup: p.ageGroup, section: p.section, checkedInBy: 'demo@example.com', checkedInAt: ts });
    });
    if (w <= 3) {
      attendance.push({ id: uid('a'), eventId: ev.id, personId: g1.id, personName: 'Alicia Moreno', category: w === 3 ? 'first_time' : 'returning', ageGroup: 'adult', section: '1', checkedInBy: 'demo@example.com', checkedInAt: ts });
    }
    if (w === 1) {
      attendance.push({ id: uid('a'), eventId: ev.id, personId: g2.id, personName: '', category: 'first_time', ageGroup: 'adult', section: '2', checkedInBy: 'demo@example.com', checkedInAt: ts });
    }
    if (w % 2 === 0) {
      const yd = addDays(date, 3);
      const yev: ChurchEvent = { id: uid('e'), eventTypeId: youth.id, date: yd, name: '', anonCount: 1, anonNotes: 'friend of Jordan', notes: '', createdBy: 'demo@example.com', createdAt: ts, updatedBy: '', updatedAt: '' };
      events.push(yev);
      people
        .filter((p) => p.ageGroup === 'youth')
        .forEach((p, i) => {
          if ((i + w) % 4 === 0) return;
          attendance.push({ id: uid('a'), eventId: yev.id, personId: p.id, personName: `${p.firstName} ${p.lastName}`, category: p.category, ageGroup: p.ageGroup, section: p.section, checkedInBy: 'demo@example.com', checkedInAt: ts });
        });
    }
  }

  return {
    People: people.map((p) => toRaw('People', p)),
    Families: families.map((f) => toRaw('Families', f)),
    FamilyMembers: members.map((m) => toRaw('FamilyMembers', m)),
    EventTypes: types.map((t) => toRaw('EventTypes', t)),
    Events: events.map((e) => toRaw('Events', e)),
    Attendance: attendance.map((a) => toRaw('Attendance', a)),
    AuditLog: [],
  };
}
