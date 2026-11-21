import { useMemo, useState } from 'react';
import { newPerson, useStore } from '../data/store';
import { DAYS, type AgeGroup, type Category, type EventKind, type EventType, type Family, type FamilyMember, type Person } from '../types';
import { downloadFile, fmtDateTime, parseCsv, toCsv, todayStr, uid } from '../util';
import { Empty, Icon, Modal } from '../components/ui';
import { TABLES } from '../data/schema';
import { DemoBackend } from '../data/demoBackend';
import { fmtTime } from './CheckIn';
import { ageGroupFromBirthdate } from '../logic/rules';
import { LegacyImport } from '../components/LegacyImport';

export function Settings({ onSignOut, onSwitchToReal, sheetUrl }: { onSignOut: () => void; onSwitchToReal: () => void; sheetUrl: string }) {
  const { db, backend, reload, saveEventType } = useStore();
  const [editType, setEditType] = useState<EventType | null>(null);
  const [importing, setImporting] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const types = [...db.EventTypes].sort((a, b) => a.sortOrder - b.sortOrder);

  const exportAll = () => {
    const tables: [string, object[]][] = TABLES.map((t) => [t, db[t] as object[]]);
    for (const [name, rows] of tables) {
      if (!rows.length) continue;
      const cols = Object.keys(rows[0]);
      downloadFile(`${name}-${todayStr()}.csv`, toCsv([cols, ...rows.map((r) => cols.map((c) => String((r as Record<string, unknown>)[c] ?? '')))]));
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>Settings</h1>
      </div>

      {backend.kind === 'demo' && (
        <div className="card notice">
          <b>Demo mode</b>
          <p>You're using sample data stored only in this browser. Nothing is saved to Google Sheets.</p>
          <div className="btn-row">
            <button className="btn primary" onClick={onSwitchToReal}>
              Connect Google Sheet
            </button>
            <button
              className="btn"
              onClick={() => {
                if (confirm('Reset the demo data back to the sample people and events?')) {
                  DemoBackend.reset();
                  location.reload();
                }
              }}
            >
              Reset demo data
            </button>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <h3>Event types</h3>
          <button
            className="btn sm primary"
            onClick={() => setEditType({ id: uid('et'), name: '', kind: 'custom', audience: 'all', dayOfWeek: '', time: '', active: true, sortOrder: types.length + 1 })}
          >
            <Icon name="plus" size={16} /> Add
          </button>
        </div>
        <ul className="people simple">
          {types.map((t) => (
            <li key={t.id} className="person-row">
              <button className="row-main" onClick={() => setEditType(t)}>
                <span className="who">
                  <span className="nm">
                    {t.name} {!t.active && <span className="chip sm inactive">Hidden</span>}
                  </span>
                  <span className="tags">
                    <span className="desc">
                      {t.dayOfWeek !== '' ? `${DAYS[Number(t.dayOfWeek)]}s` : 'No regular day'}
                      {t.time ? ` · ${fmtTime(t.time)}` : ''}
                      {t.audience === 'youth' ? ' · Youth only' : ''}
                      {t.kind === 'special' ? ' · asks for a name each time' : ''}
                    </span>
                  </span>
                </span>
                <Icon name="chevron" size={16} />
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="card">
        <h3>People</h3>
        <p className="muted small">Bring in your existing list from a CSV file (in Google Sheets: File → Download → CSV).</p>
        <div className="btn-row">
          <button className="btn" onClick={() => setImporting(true)}>
            <Icon name="upload" size={16} /> Import people from CSV
          </button>
          <button className="btn" disabled={backend.kind === 'demo'} onClick={() => setLegacy(true)}>
            <Icon name="upload" size={16} /> Import old attendance sheet
          </button>
        </div>
        {backend.kind === 'demo' && <p className="muted small">Importing an old attendance sheet needs Google sign-in (not available in demo).</p>}
      </div>

      <div className="card">
        <h3>Data</h3>
        {backend.kind === 'sheets' && (
          <p className="small">
            Connected to{' '}
            <a href={sheetUrl} target="_blank" rel="noreferrer">
              your Google Sheet
            </a>{' '}
            as <b>{backend.userEmail()}</b>.
          </p>
        )}
        <p className="muted small">
          {db.People.length} people · {db.Families.length} families · {db.Events.length} events · {db.Attendance.length} check-ins
        </p>
        <div className="btn-row">
          <button className="btn" onClick={() => reload()}>
            <Icon name="refresh" size={16} /> Refresh
          </button>
          <button className="btn" onClick={exportAll}>
            <Icon name="download" size={16} /> Export everything (CSV)
          </button>
          <button className="btn" onClick={() => setShowLog(true)}>
            Change history
          </button>
        </div>
      </div>

      <div className="card">
        <h3>Account</h3>
        <button className="btn" onClick={onSignOut}>
          <Icon name="logout" size={16} /> {backend.kind === 'demo' ? 'Leave demo' : 'Sign out'}
        </button>
      </div>

      {editType && <EventTypeForm type={editType} onClose={() => setEditType(null)} onSave={saveEventType} />}
      {importing && <ImportCsv onClose={() => setImporting(false)} />}
      {legacy && <LegacyImport onClose={() => setLegacy(false)} />}
      {showLog && (
        <Modal title="Change history" onClose={() => setShowLog(false)} wide>
          {db.AuditLog.length === 0 ? (
            <Empty>No changes recorded yet.</Empty>
          ) : (
            <ul className="plain small log">
              {[...db.AuditLog]
                .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
                .slice(0, 300)
                .map((l) => (
                  <li key={l.id}>
                    <b>{fmtDateTime(l.timestamp)}</b> · {l.user || 'unknown'} · {l.action} {l.entity}: {l.details}
                  </li>
                ))}
            </ul>
          )}
        </Modal>
      )}
    </div>
  );
}

function EventTypeForm({ type, onClose, onSave }: { type: EventType; onClose: () => void; onSave: (t: EventType) => Promise<void> }) {
  const [t, setT] = useState(type);
  const builtIn = ['sunday', 'special', 'youth'].includes(type.kind);
  return (
    <Modal
      title={type.name ? 'Edit event type' : 'New event type'}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn primary"
            disabled={!t.name.trim()}
            onClick={async () => {
              await onSave({ ...t, name: t.name.trim() });
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span>Name</span>
        <input autoFocus value={t.name} placeholder="e.g. Wednesday Bible Study" onChange={(e) => setT({ ...t, name: e.target.value })} />
      </label>
      <div className="row2">
        <label className="field">
          <span>Regular day</span>
          <select value={t.dayOfWeek} onChange={(e) => setT({ ...t, dayOfWeek: e.target.value })}>
            <option value="">None</option>
            {DAYS.map((d, i) => (
              <option key={d} value={String(i)}>
                {d}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Time</span>
          <input type="time" value={t.time} onChange={(e) => setT({ ...t, time: e.target.value })} />
        </label>
      </div>
      <p className="muted small">On its regular day, check-in opens to this event automatically.</p>
      <div className="field">
        <span>Who's on the check-in list</span>
        <div className="pill-row">
          <button className={`pill ${t.audience === 'all' ? 'on' : ''}`} onClick={() => setT({ ...t, audience: 'all' })}>
            Everyone
          </button>
          <button className={`pill age-youth ${t.audience === 'youth' ? 'on' : ''}`} onClick={() => setT({ ...t, audience: 'youth' })}>
            Youth only
          </button>
        </div>
      </div>
      {!builtIn && (
        <label className="check-line">
          <input type="checkbox" checked={t.kind === 'special'} onChange={(e) => setT({ ...t, kind: (e.target.checked ? 'special' : 'custom') as EventKind })} /> Ask for an event name each time
        </label>
      )}
      <label className="field">
        <span>Order in lists</span>
        <input type="number" value={t.sortOrder} onChange={(e) => setT({ ...t, sortOrder: Number(e.target.value) })} />
      </label>
      <label className="check-line">
        <input type="checkbox" checked={!t.active} onChange={(e) => setT({ ...t, active: !e.target.checked })} /> Hide this event type (past data is kept)
      </label>
    </Modal>
  );
}

// ---------------- CSV import ----------------

const FIELDS: { key: string; label: string; guess: RegExp }[] = [
  { key: 'firstName', label: 'First name', guess: /^(first|first ?name|given)/i },
  { key: 'lastName', label: 'Last name', guess: /^(last|last ?name|surname|family ?name)$/i },
  { key: 'fullName', label: 'Full name (one column)', guess: /^(name|full ?name)$/i },
  { key: 'ageGroup', label: 'Age group / tag', guess: /(age ?group|tag|age$|group)/i },
  { key: 'category', label: 'Category', guess: /(category|type|status)/i },
  { key: 'section', label: 'Section', guess: /(section|seat)/i },
  { key: 'birthdate', label: 'Birthdate', guess: /(birth|dob|bday)/i },
  { key: 'phone', label: 'Phone', guess: /(phone|cell|mobile)/i },
  { key: 'email', label: 'Email', guess: /e-?mail/i },
  { key: 'address', label: 'Address', guess: /(address|street)/i },
  { key: 'family', label: 'Family / household', guess: /(family|household)/i },
  { key: 'notes', label: 'Notes', guess: /(note|comment)/i },
];

function toAge(v: string): AgeGroup | null {
  const s = v.toLowerCase();
  if (!s) return null;
  if (/infant|baby|nursery/.test(s)) return 'infant';
  if (/youth|teen|student|jr|middle|high/.test(s)) return 'youth';
  if (/kid|child|pre-?k|elementary/.test(s)) return 'kids';
  if (/adult|senior/.test(s)) return 'adult';
  return null;
}

function toCat(v: string): Category | null {
  const s = v.toLowerCase();
  if (/first/.test(s)) return 'first_time';
  if (/return/.test(s)) return 'returning';
  if (/regular|member|attend/.test(s)) return 'regular';
  if (/guest|visitor/.test(s)) return 'returning';
  return null;
}

function toIsoDate(v: string): string {
  const s = v.trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) {
    let y = Number(m[3]);
    if (y < 100) y += y > new Date().getFullYear() % 100 ? 1900 : 2000;
    return `${y}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? '' : todayStr(d);
}

function ImportCsv({ onClose }: { onClose: () => void }) {
  const { db, importData, toast } = useStore();
  const [rows, setRows] = useState<string[][] | null>(null);
  const [map, setMap] = useState<Record<string, number>>({});
  const [defaultCat, setDefaultCat] = useState<Category>('regular');
  const [grouping, setGrouping] = useState<'column' | 'lastAddress' | 'none'>('lastAddress');
  const [busy, setBusy] = useState(false);

  const header = rows?.[0] ?? [];
  const body = rows?.slice(1) ?? [];

  const onFile = async (f: File) => {
    const text = await f.text();
    const r = parseCsv(text);
    if (r.length < 2) {
      toast('That file has no rows to import', 'error');
      return;
    }
    const m: Record<string, number> = {};
    const used = new Set<number>();
    for (const fld of FIELDS) {
      const i = r[0].findIndex((h, idx) => !used.has(idx) && fld.guess.test(h.trim()));
      if (i >= 0) {
        m[fld.key] = i;
        used.add(i);
      }
    }
    if (m.fullName != null && (m.firstName != null || m.lastName != null)) delete m.fullName;
    setMap(m);
    setGrouping(m.family != null ? 'column' : 'lastAddress');
    setRows(r);
  };

  const parsed = useMemo(() => {
    if (!rows) return null;
    const get = (r: string[], k: string) => (map[k] != null ? (r[map[k]] ?? '').trim() : '');
    const existing = new Set(db.People.map((p) => `${p.firstName} ${p.lastName}`.toLowerCase().trim()));
    const people: Person[] = [];
    const famKey: string[] = [];
    let dupes = 0;
    for (const r of body) {
      let first = get(r, 'firstName');
      let last = get(r, 'lastName');
      const full = get(r, 'fullName');
      if (full && !first && !last) {
        if (full.includes(',')) [last, first] = full.split(',').map((x) => x.trim());
        else {
          const parts = full.split(/\s+/);
          last = parts.length > 1 ? parts.pop()! : '';
          first = parts.join(' ');
        }
      }
      if (!first && !last) continue;
      if (existing.has(`${first} ${last}`.toLowerCase().trim())) {
        dupes++;
        continue;
      }
      existing.add(`${first} ${last}`.toLowerCase().trim());
      const birthdate = toIsoDate(get(r, 'birthdate'));
      const ageRaw = get(r, 'ageGroup');
      const ag = toAge(ageRaw);
      const cat = toCat(get(r, 'category')) ?? defaultCat;
      const sec = get(r, 'section').replace(/\D/g, '');
      people.push(
        newPerson({
          firstName: first,
          lastName: last,
          birthdate,
          ageGroup: (birthdate && ageGroupFromBirthdate(birthdate)) || ag || 'adult',
          ageGroupManual: false,
          category: cat,
          section: ['1', '2', '3', '4'].includes(sec) ? sec : '',
          phone: get(r, 'phone'),
          email: get(r, 'email'),
          address: get(r, 'address'),
          notes: get(r, 'notes'),
          followUp: cat === 'regular' ? '' : 'needed',
        }),
      );
      famKey.push(grouping === 'column' ? get(r, 'family') : grouping === 'lastAddress' ? (last ? `${last}|${get(r, 'address').toLowerCase()}` : '') : '');
    }
    const families: Family[] = [];
    const members: FamilyMember[] = [];
    const groups = new Map<string, Person[]>();
    people.forEach((p, i) => {
      const k = famKey[i];
      if (!k) return;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    });
    for (const [k, ps] of groups) {
      if (ps.length < 2 && grouping !== 'column') continue;
      const adult = ps.find((p) => p.ageGroup === 'adult');
      const name = grouping === 'column' ? k.replace(/^the\s+/i, '').replace(/\s+family$/i, '') : ps[0].lastName;
      const f: Family = { id: uid('f'), name, primaryAdultId: adult?.id ?? '', notes: '' };
      families.push(f);
      ps.forEach((p) => members.push({ id: uid('fm'), familyId: f.id, personId: p.id }));
    }
    return { people, families, members, dupes };
  }, [rows, map, defaultCat, grouping, db.People, body]);

  const doImport = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      await importData(parsed.people, parsed.families, parsed.members);
      toast(`Imported ${parsed.people.length} people and ${parsed.families.length} families`);
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import people"
      onClose={onClose}
      wide
      footer={
        rows && (
          <>
            <button className="btn" onClick={() => setRows(null)}>
              Choose another file
            </button>
            <span className="spacer" />
            <button className="btn primary" disabled={busy || !parsed?.people.length} onClick={doImport}>
              {busy ? 'Importing…' : `Import ${parsed?.people.length ?? 0} people`}
            </button>
          </>
        )
      }
    >
      {!rows ? (
        <>
          <p>Choose a CSV file. The first row should be column names, like:</p>
          <pre className="sample">First Name,Last Name,Age Group,Section,Phone,Email,Birthdate,Family</pre>
          <p className="muted small">Any columns work; you'll match them up next. People already in the app (same first + last name) are skipped.</p>
          <input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        </>
      ) : (
        <>
          <p className="muted small">
            {body.length} rows found. Match your columns:
          </p>
          <div className="map-grid">
            {FIELDS.map((f) => (
              <label key={f.key} className="field">
                <span>{f.label}</span>
                <select
                  value={map[f.key] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setMap((m) => {
                      const n = { ...m };
                      if (v === '') delete n[f.key];
                      else n[f.key] = Number(v);
                      return n;
                    });
                  }}
                >
                  <option value="">— not in file —</option>
                  {header.map((h, i) => (
                    <option key={i} value={i}>
                      {h || `Column ${i + 1}`}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          <div className="row2">
            <label className="field">
              <span>Category when not in file</span>
              <select value={defaultCat} onChange={(e) => setDefaultCat(e.target.value as Category)}>
                <option value="regular">Regular attendee</option>
                <option value="returning">Returning guest</option>
                <option value="first_time">First-time guest</option>
              </select>
            </label>
            <label className="field">
              <span>Group into families by</span>
              <select value={grouping} onChange={(e) => setGrouping(e.target.value as typeof grouping)}>
                <option value="column" disabled={map.family == null}>
                  Family column
                </option>
                <option value="lastAddress">Same last name + address</option>
                <option value="none">Don't group</option>
              </select>
            </label>
          </div>
          {parsed && (
            <div className="card notice">
              Will add <b>{parsed.people.length}</b> people in <b>{parsed.families.length}</b> families
              {parsed.dupes ? ` (skipping ${parsed.dupes} already in the app)` : ''}. Age groups are filled from birthdate when there is one.
            </div>
          )}
          {parsed && parsed.people.length > 0 && (
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Age</th>
                    <th>Cat.</th>
                    <th>Sec</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.people.slice(0, 8).map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.firstName} {p.lastName}
                      </td>
                      <td>{p.birthdate ? `${p.birthdate}` : p.ageGroup}</td>
                      <td>{p.category}</td>
                      <td>{p.section}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {parsed.people.length > 8 && <p className="muted small">…and {parsed.people.length - 8} more</p>}
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
