import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../data/store';
import { AGE_GROUPS, CATEGORIES, SECTIONS, type AgeGroup, type Category, type ChurchEvent, type EventType, type Family, type Person } from '../types';
import { displayName, fmtDate, fmtDateTime, matchesSearch, parseDate, sortKey, todayStr, uid } from '../util';
import { AgeChip, CategoryChip, Empty, FilterChip, Icon, Modal, SearchBox, SectionBadge, Segmented } from '../components/ui';
import { PersonForm } from '../components/PersonForm';
import { FamilyForm } from './People';

type View = 'list' | 'families' | 'sections';

function defaultTypeFor(date: string, types: EventType[]): EventType | undefined {
  const dow = String(parseDate(date).getDay());
  const active = types.filter((t) => t.active).sort((a, b) => a.sortOrder - b.sortOrder);
  return active.find((t) => t.dayOfWeek === dow) ?? active.find((t) => t.kind === 'sunday') ?? active[0];
}

const prefs = {
  get: <T,>(k: string, d: T): T => {
    try {
      const v = localStorage.getItem('ca.pref.' + k);
      return v == null ? d : JSON.parse(v);
    } catch {
      return d;
    }
  },
  set: (k: string, v: unknown) => {
    try {
      localStorage.setItem('ca.pref.' + k, JSON.stringify(v));
    } catch {
      /* ignore */
    }
  },
};

export function CheckIn({ eventId: routeEventId, onNavigate }: { eventId?: string; onNavigate: (path: string) => void }) {
  const { db, saveEvent, toast, saving } = useStore();
  const types = useMemo(() => db.EventTypes.filter((t) => t.active).sort((a, b) => a.sortOrder - b.sortOrder), [db.EventTypes]);

  // ---- which event ----
  const routeEvent = routeEventId ? db.Events.find((e) => e.id === routeEventId) : undefined;
  const [date, setDate] = useState(() => routeEvent?.date ?? todayStr());
  const [typeId, setTypeId] = useState(() => routeEvent?.eventTypeId ?? defaultTypeFor(todayStr(), db.EventTypes)?.id ?? '');
  const [eventId, setEventId] = useState<string | null>(routeEvent?.id ?? null);
  const [name, setName] = useState(routeEvent?.name ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (routeEvent) {
      setDate(routeEvent.date);
      setTypeId(routeEvent.eventTypeId);
      setEventId(routeEvent.id);
      setName(routeEvent.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeEventId]);

  useEffect(() => {
    if (!typeId && types.length) setTypeId(defaultTypeFor(date, db.EventTypes)?.id ?? types[0].id);
  }, [types, typeId, date, db.EventTypes]);

  const type = db.EventTypes.find((t) => t.id === typeId);
  const sameDay = db.Events.filter((e) => e.date === date && e.eventTypeId === typeId);
  const event: ChurchEvent | undefined = eventId ? db.Events.find((e) => e.id === eventId) : undefined;

  // ---- attendance state ----
  const draftKey = `ca.draft.${eventId ?? `new:${date}:${typeId}`}`;
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [anon, setAnon] = useState(0);
  const [anonNotes, setAnonNotes] = useState('');
  const [notes, setNotes] = useState('');
  const [dirty, setDirty] = useState(false);
  const loadedKey = useRef('');

  useEffect(() => {
    if (loadedKey.current === draftKey) return;
    loadedKey.current = draftKey;
    const saved = eventId ? db.Attendance.filter((a) => a.eventId === eventId).map((a) => a.personId) : [];
    let draft: { ids: string[]; anon: number; anonNotes: string; notes: string } | null = null;
    try {
      draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
    } catch {
      draft = null;
    }
    if (draft) {
      setChecked(new Set(draft.ids));
      setAnon(draft.anon);
      setAnonNotes(draft.anonNotes);
      setNotes(draft.notes);
      setDirty(true);
    } else {
      setChecked(new Set(saved));
      setAnon(event?.anonCount ?? 0);
      setAnonNotes(event?.anonNotes ?? '');
      setNotes(event?.notes ?? '');
      setDirty(false);
    }
  }, [draftKey, eventId, db.Attendance, event]);

  // keep an unsaved draft so a reload or accidental tab-close doesn't lose check-ins
  useEffect(() => {
    if (!dirty) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify({ ids: [...checked], anon, anonNotes, notes }));
    } catch {
      /* ignore */
    }
  }, [dirty, checked, anon, anonNotes, notes, draftKey]);

  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const toggle = (id: string, on?: boolean) => {
    setChecked((s) => {
      const n = new Set(s);
      const want = on ?? !n.has(id);
      want ? n.add(id) : n.delete(id);
      return n;
    });
    setDirty(true);
  };

  // ---- list filters ----
  const [q, setQ] = useState('');
  const [order, setOrder] = useState<'first' | 'last'>(() => prefs.get('order', 'last'));
  const [view, setView] = useState<View>(() => prefs.get('view', 'list'));
  const [secF, setSecF] = useState<string[]>([]);
  const [ageF, setAgeF] = useState<AgeGroup[]>([]);
  const [catF, setCatF] = useState<Category[]>([]);
  const [hereOnly, setHereOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Person | null>(null);
  const [famPick, setFamPick] = useState<Person | null>(null);
  const [editingFamily, setEditingFamily] = useState<Family | null>(null);
  const [primaryOnly, setPrimaryOnly] = useState<boolean>(() => prefs.get('famPrimaryOnly', true));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  useEffect(() => prefs.set('famPrimaryOnly', primaryOnly), [primaryOnly]);

  useEffect(() => prefs.set('order', order), [order]);
  useEffect(() => {
    prefs.set('view', view);
    // section buttons only show in the Sections view, so don't leave a hidden section filter on
    if (view !== 'sections') setSecF([]);
  }, [view]);

  const youthOnly = type?.audience === 'youth' && !showAll;

  const visible = useMemo(() => {
    return db.People.filter((p) => (p.status === 'active' || checked.has(p.id)))
      .filter((p) => !youthOnly || p.ageGroup === 'youth' || checked.has(p.id))
      .filter((p) => matchesSearch(p, q))
      .filter((p) => !secF.length || secF.includes(p.section))
      .filter((p) => !ageF.length || ageF.includes(p.ageGroup))
      .filter((p) => !catF.length || catF.includes(p.category))
      .filter((p) => !hereOnly || checked.has(p.id))
      .sort((a, b) => sortKey(a, order).localeCompare(sortKey(b, order)));
  }, [db.People, checked, youthOnly, q, secF, ageF, catF, hereOnly, order]);

  const familiesOf = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const fm of db.FamilyMembers) {
      if (!m.has(fm.personId)) m.set(fm.personId, []);
      m.get(fm.personId)!.push(fm.familyId);
    }
    return m;
  }, [db.FamilyMembers]);

  const membersOf = (familyId: string) =>
    db.FamilyMembers.filter((m) => m.familyId === familyId)
      .map((m) => db.People.find((p) => p.id === m.personId))
      .filter((p): p is Person => !!p && p.status === 'active');

  const checkFamily = (familyId: string) => {
    const mem = membersOf(familyId).filter((p) => !youthOnly || p.ageGroup === 'youth');
    const before = new Set(checked);
    const fam = db.Families.find((f) => f.id === familyId);
    setChecked((s) => {
      const n = new Set(s);
      mem.forEach((p) => n.add(p.id));
      return n;
    });
    setDirty(true);
    const added = mem.filter((p) => !before.has(p.id)).length;
    toast(added ? `Checked in ${fam?.name} family (+${added}). Untick anyone who isn't here.` : `${fam?.name} family is already checked in`);
  };

  const onFamilyTap = (p: Person) => {
    const fams = familiesOf.get(p.id) ?? [];
    if (fams.length === 1) checkFamily(fams[0]);
    else if (fams.length > 1) setFamPick(p);
  };

  // ---- save ----
  const counts = useMemo(() => {
    const c = { total: checked.size, adult: 0, youth: 0, kids: 0, infant: 0, first_time: 0, returning: 0, non_regular: 0 };
    for (const id of checked) {
      const p = db.People.find((x) => x.id === id);
      if (!p) continue;
      c[p.ageGroup]++;
      if (p.category !== 'regular') c[p.category]++;
    }
    return c;
  }, [checked, db.People]);

  const needsName = type?.kind === 'special' && !name.trim();

  const submit = async () => {
    if (!type) return;
    if (needsName) {
      setPickerOpen(true);
      toast('Enter a name for this special event', 'error');
      return;
    }
    const ev: ChurchEvent = event
      ? { ...event, date, eventTypeId: typeId, name: name.trim(), anonCount: anon, anonNotes, notes }
      : { id: uid('e'), eventTypeId: typeId, date, name: name.trim(), anonCount: anon, anonNotes, notes, createdBy: '', createdAt: '', updatedBy: '', updatedAt: '' };
    try {
      const saved = await saveEvent(ev, [...checked]);
      localStorage.removeItem(draftKey);
      loadedKey.current = `ca.draft.${saved.id}`;
      setEventId(saved.id);
      setDirty(false);
      toast(`Saved — ${checked.size + anon} total (${checked.size} named${anon ? `, ${anon} anonymous` : ''})`);
    } catch {
      /* toast already shown; draft kept */
    }
  };

  const discard = () => {
    localStorage.removeItem(draftKey);
    loadedKey.current = '';
    setDirty(false);
    // force reload of saved state
    setChecked(new Set(eventId ? db.Attendance.filter((a) => a.eventId === eventId).map((a) => a.personId) : []));
    setAnon(event?.anonCount ?? 0);
    setAnonNotes(event?.anonNotes ?? '');
    setNotes(event?.notes ?? '');
    loadedKey.current = draftKey;
  };

  const switchEvent = (fn: () => void) => {
    if (dirty && !confirm('You have unsaved check-ins for this event. Switch anyway? (Your draft is kept on this device.)')) return;
    fn();
  };

  if (!types.length) return <Empty>No event types yet. Add one in Settings.</Empty>;

  const title = type ? (type.kind === 'special' && name ? name : type.name) : 'Choose event';
  const nFilters = secF.length + ageF.length + catF.length + (hereOnly ? 1 : 0);

  const renderRow = (p: Person, inFamily = false) => {
    const on = checked.has(p.id);
    const fams = familiesOf.get(p.id) ?? [];
    return (
      <li key={p.id + (inFamily ? '-f' : '')} className={`person-row ${on ? 'on' : ''}`}>
        <button className="row-main" onClick={() => toggle(p.id)} aria-pressed={on}>
          <span className={`box ${on ? 'on' : ''}`}>{on && <Icon name="check" size={18} />}</span>
          <span className="who">
            <span className="nm">{displayName(p, order)}</span>
            <span className="tags">
              <AgeChip age={p.ageGroup} small />
              <CategoryChip cat={p.category} small />
              {p.status === 'inactive' && <span className="chip sm inactive">Inactive</span>}
              {(p.firstName || p.lastName) && p.description && <span className="desc">{p.description}</span>}
            </span>
          </span>
          <SectionBadge section={p.section} />
        </button>
        {!inFamily && fams.length > 0 && (
          <button className="icon-btn fam-btn" title="Check in whole family" aria-label={`Check in ${p.lastName} family`} onClick={() => onFamilyTap(p)}>
            <Icon name="users" />
          </button>
        )}
        <button className="btn sm ghost row-edit" aria-label={`Edit ${displayName(p)}`} onClick={() => setEditing(p)}>
          <Icon name="edit" size={18} />
          <span className="lbl">Edit</span>
        </button>
      </li>
    );
  };

  const renderFamilies = () => {
    const visibleIds = new Set(visible.map((p) => p.id));
    const fams = db.Families.map((f) => ({ f, mem: membersOf(f.id).filter((p) => visibleIds.has(p.id)) }))
      .filter((x) => x.mem.length)
      .sort((a, b) => a.f.name.localeCompare(b.f.name));
    const inAFamily = new Set(db.FamilyMembers.map((m) => m.personId));
    const singles = visible.filter((p) => !inAFamily.has(p.id));
    return (
      <>
        {fams.map(({ f, mem }) => {
          const all = mem.every((p) => checked.has(p.id));
          const pa = db.People.find((p) => p.id === f.primaryAdultId);
          const sorted = [...mem].sort((a, b) => sortKey(a, order).localeCompare(sortKey(b, order)));
          // "Primary only": show the primary adult; the rest stay tucked away until the family is opened.
          // Searching always shows the matching people.
          const lead = sorted.find((p) => p.id === f.primaryAdultId) ?? sorted[0];
          const collapsed = primaryOnly && !q.trim() && !expanded.has(f.id) && sorted.length > 1;
          const shown = collapsed ? [lead] : [lead, ...sorted.filter((p) => p !== lead)];
          const hidden = sorted.filter((p) => p !== lead);
          const hiddenHere = hidden.filter((p) => checked.has(p.id)).length;
          const toggleOpen = () =>
            setExpanded((s) => {
              const n = new Set(s);
              n.has(f.id) ? n.delete(f.id) : n.add(f.id);
              return n;
            });
          return (
            <section key={f.id} className="fam-card">
              <header>
                <div>
                  <b>{f.name}</b>
                  {pa && <span className="muted"> · {pa.firstName}</span>}
                  <span className="muted"> · {mem.filter((p) => checked.has(p.id)).length}/{mem.length}</span>
                </div>
                <span className="spacer" />
                <button className="btn sm ghost row-edit" aria-label={`Edit ${f.name} family`} onClick={() => setEditingFamily(f)}>
                  <Icon name="edit" size={18} />
                  <span className="lbl">Edit family</span>
                </button>
                <button
                  className={`btn sm ${all ? '' : 'primary'}`}
                  onClick={() => {
                    if (all) {
                      setChecked((s) => {
                        const n = new Set(s);
                        mem.forEach((p) => n.delete(p.id));
                        return n;
                      });
                      setDirty(true);
                    } else checkFamily(f.id);
                  }}
                >
                  {all ? 'Clear' : 'Check in all'}
                </button>
              </header>
              <ul className="people">
                {shown.map((p) => renderRow(p, true))}
                {primaryOnly && !q.trim() && hidden.length > 0 && (
                  <li className="fam-more">
                    <button onClick={toggleOpen} aria-expanded={!collapsed}>
                      <Icon name={collapsed ? 'chevron' : 'back'} size={16} />
                      {collapsed ? (
                        <span>
                          {hidden.length} more: {hidden.map((p) => p.firstName || displayName(p)).join(', ')}
                          {hiddenHere > 0 && <b> · {hiddenHere} here</b>}
                        </span>
                      ) : (
                        <span>Hide the rest of the family</span>
                      )}
                    </button>
                  </li>
                )}
              </ul>
            </section>
          );
        })}
        {singles.length > 0 && (
          <section className="fam-card">
            <header>
              <b>Not in a family</b>
            </header>
            <ul className="people">{singles.map((p) => renderRow(p, true))}</ul>
          </section>
        )}
      </>
    );
  };

  const renderSections = () => {
    const groups = [...SECTIONS, ''].map((s) => ({ s, list: visible.filter((p) => p.section === s) })).filter((g) => g.list.length);
    return groups.map((g) => (
      <section key={g.s || 'none'} className="fam-card">
        <header>
          <b>{g.s ? `Section ${g.s}` : 'No section'}</b>
          <span className="muted">
            {g.list.filter((p) => checked.has(p.id)).length}/{g.list.length}
          </span>
        </header>
        <ul className="people">{g.list.map((p) => renderRow(p))}</ul>
      </section>
    ));
  };

  return (
    <div className="page checkin">
      <div className="event-bar">
        <button className="event-title" onClick={() => setPickerOpen(true)}>
          <span>
            <b>{title}</b>
            <span className="muted">
              {fmtDate(date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
              {type?.time ? ` · ${fmtTime(type.time)}` : ''}
            </span>
          </span>
          <span className="change">
            {event ? 'Editing saved' : 'New'} <Icon name="chevron" size={16} />
          </span>
        </button>
        {event && (event.updatedAt || event.createdAt) && (
          <div className="audit-line">
            {event.updatedAt ? `Last edited by ${event.updatedBy || 'unknown'} · ${fmtDateTime(event.updatedAt)}` : `Saved by ${event.createdBy || 'unknown'} · ${fmtDateTime(event.createdAt)}`}
          </div>
        )}
      </div>

      <div className="toolbar sticky">
        <SearchBox value={q} onChange={setQ} placeholder="Search name, phone, description" />
        <div className="toolbar-row">
          <Segmented
            value={view}
            onChange={setView}
            options={[
              { id: 'list', label: 'A–Z' },
              { id: 'families', label: 'Families' },
              { id: 'sections', label: 'Sections' },
            ]}
          />
          <button className="btn sm ghost" onClick={() => setOrder(order === 'first' ? 'last' : 'first')} title="Sort order">
            <Icon name="sort" size={16} /> {order === 'first' ? 'First' : 'Last'}
          </button>
          <button className={`btn sm ghost ${nFilters ? 'has' : ''}`} onClick={() => setFiltersOpen((x) => !x)}>
            <Icon name="filter" size={16} /> {nFilters ? nFilters : ''}
          </button>
        </div>
        <div className="chip-scroll">
          {view === 'sections' &&
            SECTIONS.map((s) => (
              <FilterChip key={s} on={secF.includes(s)} onClick={() => setSecF((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]))}>
                Sec {s}
              </FilterChip>
            ))}
          <FilterChip on={hereOnly} onClick={() => setHereOnly((x) => !x)}>
            Here ({checked.size})
          </FilterChip>
          {view === 'families' && (
            <FilterChip
              on={primaryOnly}
              onClick={() => {
                setPrimaryOnly((x) => !x);
                setExpanded(new Set());
              }}
            >
              Primary only
            </FilterChip>
          )}
        </div>
        {filtersOpen && (
          <div className="filters">
            <div className="chip-scroll wrap">
              {AGE_GROUPS.map((a) => (
                <FilterChip key={a.id} className={`age-${a.id}`} on={ageF.includes(a.id)} onClick={() => setAgeF((x) => (x.includes(a.id) ? x.filter((y) => y !== a.id) : [...x, a.id]))}>
                  {a.label}
                </FilterChip>
              ))}
              {CATEGORIES.map((c) => (
                <FilterChip key={c.id} className={`cat-${c.id}`} on={catF.includes(c.id)} onClick={() => setCatF((x) => (x.includes(c.id) ? x.filter((y) => y !== c.id) : [...x, c.id]))}>
                  {c.label}
                </FilterChip>
              ))}
            </div>
            {nFilters > 0 && (
              <button
                className="link"
                onClick={() => {
                  setSecF([]);
                  setAgeF([]);
                  setCatF([]);
                  setHereOnly(false);
                }}
              >
                Clear filters
              </button>
            )}
          </div>
        )}
        {type?.audience === 'youth' && (
          <label className="check-line small">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Showing youth only — show everyone
          </label>
        )}
      </div>

      <button className="add-person" onClick={() => setAdding(true)}>
        <Icon name="plus" /> Add someone new
      </button>

      {visible.length === 0 ? (
        <Empty>{q ? `No one matches “${q}”.` : 'No people to show.'}</Empty>
      ) : view === 'families' ? (
        renderFamilies()
      ) : view === 'sections' ? (
        renderSections()
      ) : (
        <ul className="people">{visible.map((p) => renderRow(p))}</ul>
      )}

      <div className="anon-card">
        <div className="anon-row">
          <div>
            <b>Anonymous headcount</b>
            <div className="muted small">People you didn't get names for</div>
          </div>
          <div className="stepper">
            <button
              className="icon-btn"
              aria-label="Decrease"
              onClick={() => {
                setAnon((n) => Math.max(0, n - 1));
                setDirty(true);
              }}
            >
              <Icon name="minus" />
            </button>
            <input
              inputMode="numeric"
              value={anon}
              onChange={(e) => {
                setAnon(Math.max(0, parseInt(e.target.value.replace(/\D/g, '') || '0', 10)));
                setDirty(true);
              }}
            />
            <button
              className="icon-btn"
              aria-label="Increase"
              onClick={() => {
                setAnon((n) => n + 1);
                setDirty(true);
              }}
            >
              <Icon name="plus" />
            </button>
          </div>
        </div>
        {anon > 0 && (
          <input
            placeholder="Notes about these visitors (optional)"
            value={anonNotes}
            onChange={(e) => {
              setAnonNotes(e.target.value);
              setDirty(true);
            }}
          />
        )}
        <textarea
          rows={2}
          placeholder="Event notes (optional)"
          value={notes}
          onChange={(e) => {
            setNotes(e.target.value);
            setDirty(true);
          }}
        />
      </div>

      <div className="savebar">
        <div className="savebar-counts">
          <b>{checked.size + anon}</b> total
          <span className="muted small">
            {' '}
            · {checked.size} named{anon ? ` + ${anon}` : ''}
            {counts.first_time ? ` · ${counts.first_time} first-time` : ''}
          </span>
        </div>
        {dirty && event && (
          <button className="btn ghost sm" onClick={discard}>
            Undo changes
          </button>
        )}
        <button className="btn primary" disabled={saving || (!dirty && !!event)} onClick={submit}>
          {saving ? 'Saving…' : event ? (dirty ? 'Save changes' : 'Saved ✓') : 'Submit'}
        </button>
      </div>

      {pickerOpen && (
        <Modal title="Choose event" onClose={() => setPickerOpen(false)} footer={<button className="btn primary" onClick={() => setPickerOpen(false)} disabled={needsName}>Done</button>}>
          <label className="field">
            <span>Date</span>
            <input
              type="date"
              value={date}
              onChange={(e) =>
                switchEvent(() => {
                  const d = e.target.value || todayStr();
                  setDate(d);
                  const existing = db.Events.filter((x) => x.date === d && x.eventTypeId === typeId);
                  setEventId(type?.kind !== 'special' && existing.length ? existing[0].id : null);
                  setName(type?.kind !== 'special' && existing.length ? existing[0].name : '');
                })
              }
            />
          </label>
          <div className="field">
            <span>Event type</span>
            <div className="pill-row">
              {types.map((t) => (
                <button
                  key={t.id}
                  className={`pill ${t.id === typeId ? 'on' : ''}`}
                  onClick={() =>
                    switchEvent(() => {
                      setTypeId(t.id);
                      const existing = db.Events.filter((x) => x.date === date && x.eventTypeId === t.id);
                      setEventId(t.kind !== 'special' && existing.length ? existing[0].id : null);
                      setName(t.kind !== 'special' && existing.length ? existing[0].name : '');
                    })
                  }
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>
          {sameDay.length > 0 && (
            <div className="field">
              <span>Already saved for this date</span>
              <div className="list-buttons">
                {sameDay.map((e) => (
                  <button
                    key={e.id}
                    className={e.id === eventId ? 'on' : ''}
                    onClick={() =>
                      switchEvent(() => {
                        setEventId(e.id);
                        setName(e.name);
                      })
                    }
                  >
                    {e.name || type?.name} · {db.Attendance.filter((a) => a.eventId === e.id).length + e.anonCount} people
                  </button>
                ))}
                {type?.kind === 'special' && (
                  <button
                    className={!eventId ? 'on' : ''}
                    onClick={() =>
                      switchEvent(() => {
                        setEventId(null);
                        setName('');
                      })
                    }
                  >
                    + New special event
                  </button>
                )}
              </div>
            </div>
          )}
          {(type?.kind === 'special' || name) && (
            <label className="field">
              <span>Event name {type?.kind === 'special' && '*'}</span>
              <input value={name} placeholder="e.g. Christmas Eve Service" onChange={(e) => { setName(e.target.value); if (event) setDirty(true); }} />
            </label>
          )}
          <button className="link" onClick={() => { setPickerOpen(false); onNavigate('/settings'); }}>
            Add or edit event types
          </button>
        </Modal>
      )}

      {adding && (
        <PersonForm
          title="Add someone new"
          defaults={{ section: secF.length === 1 ? secF[0] : '', ageGroup: type?.audience === 'youth' ? 'youth' : 'adult' }}
          onClose={() => setAdding(false)}
          onSaved={(p) => {
            toggle(p.id, true);
            setQ('');
            toast(`${displayName(p)} added and checked in`);
          }}
        />
      )}
      {editing && <PersonForm person={db.People.find((x) => x.id === editing.id) ?? editing} onClose={() => setEditing(null)} />}
      {editingFamily && <FamilyForm family={db.Families.find((x) => x.id === editingFamily.id) ?? editingFamily} onClose={() => setEditingFamily(null)} />}
      {famPick && (
        <Modal title="Which family?" onClose={() => setFamPick(null)}>
          <div className="list-buttons">
            {(familiesOf.get(famPick.id) ?? []).map((fid) => {
              const f = db.Families.find((x) => x.id === fid);
              const pa = db.People.find((x) => x.id === f?.primaryAdultId);
              return (
                <button
                  key={fid}
                  onClick={() => {
                    checkFamily(fid);
                    setFamPick(null);
                  }}
                >
                  {f?.name}
                  {pa ? ` (${pa.firstName})` : ''} · {membersOf(fid).length} people
                </button>
              );
            })}
          </div>
        </Modal>
      )}
    </div>
  );
}

export function fmtTime(t: string) {
  const [h, m] = t.split(':').map(Number);
  if (isNaN(h)) return t;
  const d = new Date();
  d.setHours(h, m || 0);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
