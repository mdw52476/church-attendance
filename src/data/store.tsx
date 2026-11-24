import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Backend } from './backend';
import { fromRaw, toRaw, type TableName } from './schema';
import type { Attendance, AuditEntry, ChurchEvent, DB, EventType, Family, FamilyMember, Person } from '../types';
import { applyAutoRules, ageGroupFromBirthdate } from '../logic/rules';
import { defaultEventTypes } from './defaults';
import { displayName, nowIso, uid } from '../util';
import { AuthError } from './googleAuth';

const EMPTY: DB = { People: [], Families: [], FamilyMembers: [], EventTypes: [], Events: [], Attendance: [], AuditLog: [] };

interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

interface StoreValue {
  db: DB;
  backend: Backend;
  loading: boolean;
  saving: boolean;
  error: string;
  authExpired: boolean;
  toasts: Toast[];
  toast(text: string, kind?: 'ok' | 'error'): void;
  reload(): Promise<void>;
  savePerson(p: Person): Promise<Person>;
  deletePerson(id: string): Promise<void>;
  saveFamily(f: Family, memberIds: string[]): Promise<Family>;
  deleteFamily(id: string): Promise<void>;
  saveEventType(t: EventType): Promise<void>;
  saveEvent(ev: ChurchEvent, personIds: string[]): Promise<ChurchEvent>;
  deleteEvent(id: string): Promise<void>;
  importData(people: Person[], families: Family[], members: FamilyMember[], events?: ChurchEvent[], attendance?: Attendance[], onProgress?: (msg: string) => void): Promise<void>;
  updateFollowUp(p: Person, followUp: Person['followUp'], notes?: string): Promise<void>;
}

const Ctx = createContext<StoreValue | null>(null);

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore outside provider');
  return v;
}

function parseDb(raw: Record<TableName, Record<string, string>[]>): DB {
  return {
    People: raw.People.map((r) => fromRaw<Person>('People', r)).map(normalizePerson),
    Families: raw.Families.map((r) => fromRaw<Family>('Families', r)),
    FamilyMembers: raw.FamilyMembers.map((r) => fromRaw<FamilyMember>('FamilyMembers', r)),
    EventTypes: raw.EventTypes.map((r) => fromRaw<EventType>('EventTypes', r)),
    Events: raw.Events.map((r) => fromRaw<ChurchEvent>('Events', r)),
    Attendance: raw.Attendance.map((r) => fromRaw<Attendance>('Attendance', r)),
    AuditLog: raw.AuditLog.map((r) => fromRaw<AuditEntry>('AuditLog', r)),
  };
}

function normalizePerson(p: Person): Person {
  return {
    ...p,
    category: (['regular', 'non_regular', 'first_time', 'returning'].includes(p.category) ? p.category : 'regular') as Person['category'],
    ageGroup: (['adult', 'youth', 'kids', 'infant'].includes(p.ageGroup) ? p.ageGroup : 'adult') as Person['ageGroup'],
    status: p.status === 'inactive' ? 'inactive' : 'active',
  };
}

export function StoreProvider({ backend, children }: { backend: Backend; children: ReactNode }) {
  const [db, setDb] = useState<DB>(EMPTY);
  const dbRef = useRef(db);
  dbRef.current = db;
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState('');
  const [authExpired, setAuthExpired] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const toast = useCallback((text: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 2600);
  }, []);

  const handleErr = useCallback(
    (e: unknown) => {
      if (e instanceof AuthError) setAuthExpired(true);
      toast((e as Error).message || 'Something went wrong', 'error');
    },
    [toast],
  );

  /** Serialize writes so they reach the sheet in order. */
  const write = useCallback(
    <T,>(fn: () => Promise<T>): Promise<T> => {
      setSaving((s) => s + 1);
      const p = queue.current.then(fn, fn);
      queue.current = p.catch(() => {});
      return p.finally(() => setSaving((s) => s - 1));
    },
    [],
  );

  const upsert = (table: TableName, rows: object[]) => backend.upsert(table, rows.map((r) => toRaw(table, r)));

  const audit = (action: string, entity: string, entityId: string, details: string): AuditEntry => ({
    id: uid('log'),
    timestamp: nowIso(),
    user: backend.userEmail(),
    action,
    entity,
    entityId,
    details,
  });

  const reload = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await backend.init();
      let next = parseDb(await backend.loadAll());
      if (!next.EventTypes.length) {
        const types = defaultEventTypes();
        await backend.upsert('EventTypes', types.map((t) => toRaw('EventTypes', t)));
        next = { ...next, EventTypes: types };
      }
      // birthdays move people between age groups; categories may need catching up
      const changed = applyAutoRules(next.People, next.Events, next.Attendance);
      if (changed.length) {
        const m = new Map(changed.map((p) => [p.id, p]));
        next = { ...next, People: next.People.map((p) => m.get(p.id) ?? p) };
        upsert('People', changed).catch(handleErr);
      }
      setDb(next);
      setAuthExpired(false);
    } catch (e) {
      if (e instanceof AuthError) setAuthExpired(true);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backend]);

  useEffect(() => {
    reload();
  }, [reload]);

  const value = useMemo<StoreValue>(() => {
    const savePerson = async (p: Person) => {
      let next = { ...p, updatedAt: nowIso(), createdAt: p.createdAt || nowIso() };
      if (!next.ageGroupManual && next.birthdate) {
        const ag = ageGroupFromBirthdate(next.birthdate);
        if (ag) next.ageGroup = ag;
      }
      const isNew = !dbRef.current.People.some((x) => x.id === p.id);
      setDb((d) => ({ ...d, People: isNew ? [...d.People, next] : d.People.map((x) => (x.id === next.id ? next : x)) }));
      await write(async () => {
        await upsert('People', [next]);
        await upsert('AuditLog', [audit(isNew ? 'add' : 'edit', 'person', next.id, displayName(next))]);
      }).catch((e) => {
        handleErr(e);
        throw e;
      });
      return next;
    };

    const deletePerson = async (id: string) => {
      const d0 = dbRef.current;
      const p = d0.People.find((x) => x.id === id);
      const fm = d0.FamilyMembers.filter((m) => m.personId === id).map((m) => m.id);
      const at = d0.Attendance.filter((a) => a.personId === id).map((a) => a.id);
      setDb((d) => ({
        ...d,
        People: d.People.filter((x) => x.id !== id),
        FamilyMembers: d.FamilyMembers.filter((m) => m.personId !== id),
        Attendance: d.Attendance.filter((a) => a.personId !== id),
      }));
      await write(async () => {
        await backend.remove('People', [id]);
        await backend.remove('FamilyMembers', fm);
        await backend.remove('Attendance', at);
        await upsert('AuditLog', [audit('delete', 'person', id, p ? displayName(p) : id)]);
      }).catch(handleErr);
    };

    const saveFamily = async (f: Family, memberIds: string[]) => {
      const d0 = dbRef.current;
      const existing = d0.FamilyMembers.filter((m) => m.familyId === f.id);
      const keep = new Set(memberIds);
      const removed = existing.filter((m) => !keep.has(m.personId));
      const have = new Set(existing.map((m) => m.personId));
      const added: FamilyMember[] = memberIds.filter((id) => !have.has(id)).map((personId) => ({ id: uid('fm'), familyId: f.id, personId }));
      const isNew = !d0.Families.some((x) => x.id === f.id);
      setDb((d) => ({
        ...d,
        Families: isNew ? [...d.Families, f] : d.Families.map((x) => (x.id === f.id ? f : x)),
        FamilyMembers: [...d.FamilyMembers.filter((m) => !removed.some((r) => r.id === m.id)), ...added],
      }));
      await write(async () => {
        await upsert('Families', [f]);
        await upsert('FamilyMembers', added);
        await backend.remove('FamilyMembers', removed.map((r) => r.id));
        await upsert('AuditLog', [audit(isNew ? 'add' : 'edit', 'family', f.id, `${f.name} (${memberIds.length} members)`)]);
      }).catch(handleErr);
      return f;
    };

    const deleteFamily = async (id: string) => {
      const d0 = dbRef.current;
      const fm = d0.FamilyMembers.filter((m) => m.familyId === id).map((m) => m.id);
      const f = d0.Families.find((x) => x.id === id);
      setDb((d) => ({ ...d, Families: d.Families.filter((x) => x.id !== id), FamilyMembers: d.FamilyMembers.filter((m) => m.familyId !== id) }));
      await write(async () => {
        await backend.remove('Families', [id]);
        await backend.remove('FamilyMembers', fm);
        await upsert('AuditLog', [audit('delete', 'family', id, f?.name || id)]);
      }).catch(handleErr);
    };

    const saveEventType = async (t: EventType) => {
      setDb((d) => ({
        ...d,
        EventTypes: d.EventTypes.some((x) => x.id === t.id) ? d.EventTypes.map((x) => (x.id === t.id ? t : x)) : [...d.EventTypes, t],
      }));
      await write(() => upsert('EventTypes', [t])).catch(handleErr);
    };

    const saveEvent = async (ev: ChurchEvent, personIds: string[]) => {
      const d0 = dbRef.current;
      const user = backend.userEmail();
      const isNew = !d0.Events.some((x) => x.id === ev.id);
      const nextEv: ChurchEvent = isNew
        ? { ...ev, createdBy: user, createdAt: nowIso() }
        : { ...ev, updatedBy: user, updatedAt: nowIso() };
      const existing = d0.Attendance.filter((a) => a.eventId === ev.id);
      const want = new Set(personIds);
      const removed = existing.filter((a) => !want.has(a.personId));
      const have = new Set(existing.map((a) => a.personId));
      const people = new Map(d0.People.map((p) => [p.id, p]));
      const added: Attendance[] = personIds
        .filter((id) => !have.has(id))
        .map((personId) => {
          const p = people.get(personId)!;
          return {
            id: uid('a'),
            eventId: ev.id,
            personId,
            personName: p ? displayName(p) : '',
            category: p?.category ?? 'regular',
            ageGroup: p?.ageGroup ?? 'adult',
            section: p?.section ?? '',
            checkedInBy: user,
            checkedInAt: nowIso(),
          };
        });
      const attendance = [...d0.Attendance.filter((a) => !removed.some((r) => r.id === a.id)), ...added];
      const events = isNew ? [...d0.Events, nextEv] : d0.Events.map((x) => (x.id === ev.id ? nextEv : x));
      // Category rules use visit history, so evaluate after this event's changes
      const changedPeople = applyAutoRules(d0.People, events, attendance).map((p) => ({ ...p, updatedAt: nowIso() }));
      const cm = new Map(changedPeople.map((p) => [p.id, p]));
      // first-time guests need follow-up
      for (const a of added) {
        const p = cm.get(a.personId) ?? people.get(a.personId);
        if (p && (p.category === 'first_time' || p.category === 'returning') && !p.followUp) cm.set(p.id, { ...p, followUp: 'needed', updatedAt: nowIso() });
      }
      setDb((d) => ({ ...d, Events: events, Attendance: attendance, People: d.People.map((p) => cm.get(p.id) ?? p) }));
      const details = isNew
        ? `${personIds.length} checked in, ${nextEv.anonCount} anonymous`
        : `+${added.length} / -${removed.length} people; total ${personIds.length}, anonymous ${nextEv.anonCount}` +
          (removed.length ? `; removed: ${removed.map((r) => r.personName || r.personId).join(', ')}` : '') +
          (added.length ? `; added: ${added.map((r) => r.personName || r.personId).join(', ')}` : '');
      await write(async () => {
        await upsert('Events', [nextEv]);
        await upsert('Attendance', added);
        await backend.remove('Attendance', removed.map((r) => r.id));
        await upsert('People', [...cm.values()]);
        await upsert('AuditLog', [audit(isNew ? 'create' : 'edit', 'event', ev.id, details)]);
      }).catch((e) => {
        handleErr(e);
        throw e;
      });
      return nextEv;
    };

    const deleteEvent = async (id: string) => {
      const d0 = dbRef.current;
      const at = d0.Attendance.filter((a) => a.eventId === id).map((a) => a.id);
      const ev = d0.Events.find((e) => e.id === id);
      setDb((d) => ({ ...d, Events: d.Events.filter((e) => e.id !== id), Attendance: d.Attendance.filter((a) => a.eventId !== id) }));
      await write(async () => {
        await backend.remove('Events', [id]);
        await backend.remove('Attendance', at);
        await upsert('AuditLog', [audit('delete', 'event', id, `${ev?.date} (${at.length} attendees)`)]);
      }).catch(handleErr);
    };

    const importData = async (
      people: Person[],
      families: Family[],
      members: FamilyMember[],
      events: ChurchEvent[] = [],
      attendance: Attendance[] = [],
      onProgress?: (msg: string) => void,
    ) => {
      // large imports go up in chunks so no single request is too big
      const chunked = async (table: TableName, rows: object[], label: string) => {
        const size = 800;
        for (let i = 0; i < rows.length; i += size) {
          onProgress?.(`Saving ${label}… ${Math.min(i + size, rows.length)} of ${rows.length}`);
          await upsert(table, rows.slice(i, i + size));
        }
      };
      await write(async () => {
        await chunked('People', people, 'people');
        await chunked('Families', families, 'families');
        await chunked('FamilyMembers', members, 'family members');
        await chunked('Events', events, 'events');
        await chunked('Attendance', attendance, 'check-ins');
        await upsert('AuditLog', [
          audit('import', 'data', '', `${people.length} people, ${families.length} families, ${events.length} events, ${attendance.length} check-ins`),
        ]);
      }).catch((e) => {
        handleErr(e);
        throw e;
      });
      setDb((d) => ({
        ...d,
        People: [...d.People, ...people],
        Families: [...d.Families, ...families],
        FamilyMembers: [...d.FamilyMembers, ...members],
        Events: [...d.Events, ...events],
        Attendance: [...d.Attendance, ...attendance],
      }));
    };

    const updateFollowUp = async (p: Person, followUp: Person['followUp'], notes?: string) => {
      await savePerson({ ...p, followUp, followUpNotes: notes ?? p.followUpNotes });
    };

    return {
      db,
      backend,
      loading,
      saving: saving > 0,
      error,
      authExpired,
      toasts,
      toast,
      reload,
      savePerson,
      deletePerson,
      saveFamily,
      deleteFamily,
      saveEventType,
      saveEvent,
      deleteEvent,
      importData,
      updateFollowUp,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, backend, loading, saving, error, authExpired, toasts, toast, reload, write, handleErr]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function newPerson(partial: Partial<Person> = {}): Person {
  const ts = nowIso();
  return {
    id: uid('p'),
    firstName: '',
    lastName: '',
    description: '',
    category: 'regular',
    categoryManual: false,
    ageGroup: 'adult',
    ageGroupManual: false,
    birthdate: '',
    section: '',
    phone: '',
    email: '',
    address: '',
    notes: '',
    followUp: '',
    followUpNotes: '',
    status: 'active',
    firstVisit: '',
    createdAt: ts,
    updatedAt: ts,
    ...partial,
  };
}
