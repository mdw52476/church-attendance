import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { AGE_GROUPS, CATEGORIES, SECTIONS, type AgeGroup, type Category, type Family, type Person } from '../types';
import { displayName, downloadFile, fmtDate, matchesSearch, pct, sortKey, toCsv, todayStr, uid } from '../util';
import { AgeChip, CategoryChip, Confirm, Empty, FilterChip, Icon, Modal, SearchBox, SectionBadge, Segmented } from '../components/ui';
import { PersonForm } from '../components/PersonForm';
import { personStats } from '../logic/stats';
import { ageYears, gradeFromBirthdate } from '../logic/rules';

export function People() {
  const [tab, setTab] = useState<'people' | 'families'>('people');
  return (
    <div className="page">
      <div className="page-head">
        <h1>{tab === 'people' ? 'People' : 'Families'}</h1>
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { id: 'people', label: 'People' },
            { id: 'families', label: 'Families' },
          ]}
        />
      </div>
      {tab === 'people' ? <PeopleList /> : <FamilyList />}
    </div>
  );
}

function PeopleList() {
  const { db } = useStore();
  const [q, setQ] = useState('');
  const [order, setOrder] = useState<'first' | 'last'>('last');
  const [ageF, setAgeF] = useState<AgeGroup[]>([]);
  const [catF, setCatF] = useState<Category[]>([]);
  const [secF, setSecF] = useState<string[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [detail, setDetail] = useState<Person | null>(null);
  const [adding, setAdding] = useState(false);

  const list = useMemo(
    () =>
      db.People.filter((p) => showInactive || p.status === 'active')
        .filter((p) => matchesSearch(p, q))
        .filter((p) => !ageF.length || ageF.includes(p.ageGroup))
        .filter((p) => !catF.length || catF.includes(p.category))
        .filter((p) => !secF.length || secF.includes(p.section))
        .sort((a, b) => sortKey(a, order).localeCompare(sortKey(b, order))),
    [db.People, q, ageF, catF, secF, showInactive, order],
  );

  const exportCsv = () => {
    const famNames = (id: string) =>
      db.FamilyMembers.filter((m) => m.personId === id)
        .map((m) => db.Families.find((f) => f.id === m.familyId)?.name)
        .filter(Boolean)
        .join('; ');
    downloadFile(
      `people-${todayStr()}.csv`,
      toCsv([
        ['First name', 'Last name', 'Description', 'Category', 'Age group', 'Section', 'Birthdate', 'Phone', 'Email', 'Address', 'Families', 'Status', 'First visit', 'Follow-up', 'Notes'],
        ...list.map((p) => [p.firstName, p.lastName, p.description, p.category, p.ageGroup, p.section, p.birthdate, p.phone, p.email, p.address, famNames(p.id), p.status, p.firstVisit, p.followUp, p.notes]),
      ]),
    );
  };

  const toggle = <T,>(arr: T[], v: T, set: (x: T[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  return (
    <>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} />
        <div className="chip-scroll wrap">
          {AGE_GROUPS.map((a) => (
            <FilterChip key={a.id} className={`age-${a.id}`} on={ageF.includes(a.id)} onClick={() => toggle(ageF, a.id, setAgeF)}>
              {a.label}
            </FilterChip>
          ))}
          {CATEGORIES.map((c) => (
            <FilterChip key={c.id} className={`cat-${c.id}`} on={catF.includes(c.id)} onClick={() => toggle(catF, c.id, setCatF)}>
              {c.label}
            </FilterChip>
          ))}
          {SECTIONS.map((s) => (
            <FilterChip key={s} on={secF.includes(s)} onClick={() => toggle(secF, s, setSecF)}>
              Sec {s}
            </FilterChip>
          ))}
          <FilterChip on={showInactive} onClick={() => setShowInactive((x) => !x)}>
            Show inactive
          </FilterChip>
        </div>
        <div className="toolbar-row">
          <span className="muted small">{list.length} people</span>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={() => setOrder(order === 'first' ? 'last' : 'first')}>
            <Icon name="sort" size={16} /> {order === 'first' ? 'First name' : 'Last name'}
          </button>
          <button className="btn sm ghost" onClick={exportCsv}>
            <Icon name="download" size={16} /> CSV
          </button>
          <button className="btn sm primary" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} /> Add
          </button>
        </div>
      </div>
      {list.length === 0 ? (
        <Empty>No people match.</Empty>
      ) : (
        <ul className="people simple">
          {list.map((p) => (
            <li key={p.id} className="person-row">
              <button className="row-main" onClick={() => setDetail(p)}>
                <span className="who">
                  <span className="nm">{displayName(p, order)}</span>
                  <span className="tags">
                    <AgeChip age={p.ageGroup} small />
                    <CategoryChip cat={p.category} small />
                    {p.status === 'inactive' && <span className="chip sm inactive">Inactive</span>}
                    {p.followUp === 'needed' && <span className="chip sm followup">Follow up</span>}
                  </span>
                </span>
                <SectionBadge section={p.section} />
                <Icon name="chevron" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
      {detail && <PersonDetail person={db.People.find((x) => x.id === detail.id) ?? detail} onClose={() => setDetail(null)} />}
      {adding && <PersonForm title="Add person" defaults={{ category: 'regular', followUp: '' }} onClose={() => setAdding(false)} />}
    </>
  );
}

export function PersonDetail({ person: p, onClose }: { person: Person; onClose: () => void }) {
  const { db } = useStore();
  const [editing, setEditing] = useState(false);
  const types = db.EventTypes;
  const history = useMemo(() => {
    const evById = new Map(db.Events.map((e) => [e.id, e]));
    return db.Attendance.filter((a) => a.personId === p.id)
      .map((a) => evById.get(a.eventId))
      .filter((e): e is NonNullable<typeof e> => !!e)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [db, p.id]);
  const perType = useMemo(
    () =>
      types
        .map((t) => {
          const evs = db.Events.filter((e) => e.eventTypeId === t.id);
          const st = personStats({ ...db, People: [p] }, evs)[0];
          return { t, st };
        })
        .filter((x) => x.st.possible > 0 && x.st.attended > 0),
    [types, db, p],
  );
  const fams = db.FamilyMembers.filter((m) => m.personId === p.id).map((m) => db.Families.find((f) => f.id === m.familyId)).filter(Boolean) as Family[];
  const age = ageYears(p.birthdate);
  const grade = gradeFromBirthdate(p.birthdate);
  const typeName = (id: string) => types.find((t) => t.id === id)?.name ?? '';

  if (editing) return <PersonForm person={p} onClose={() => setEditing(false)} />;

  return (
    <Modal
      title={displayName(p)}
      onClose={onClose}
      footer={
        <button className="btn primary" onClick={() => setEditing(true)}>
          <Icon name="edit" size={16} /> Edit
        </button>
      }
    >
      <div className="tags big">
        <AgeChip age={p.ageGroup} />
        <CategoryChip cat={p.category} showRegular />
        {p.section && <span className="chip">Section {p.section}</span>}
        {p.status === 'inactive' && <span className="chip inactive">Inactive</span>}
      </div>
      {p.description && <p className="muted">{p.description}</p>}
      <dl className="facts">
        {p.birthdate && (
          <>
            <dt>Birthdate</dt>
            <dd>
              {fmtDate(p.birthdate)}
              {age != null ? ` · age ${age}` : ''}
              {grade ? ` · ${grade}` : ''}
            </dd>
          </>
        )}
        {p.phone && (
          <>
            <dt>Phone</dt>
            <dd>
              <a href={`tel:${p.phone}`}>{p.phone}</a>
            </dd>
          </>
        )}
        {p.email && (
          <>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${p.email}`}>{p.email}</a>
            </dd>
          </>
        )}
        {p.address && (
          <>
            <dt>Address</dt>
            <dd>{p.address}</dd>
          </>
        )}
        {fams.length > 0 && (
          <>
            <dt>Family</dt>
            <dd>{fams.map((f) => f.name).join(', ')}</dd>
          </>
        )}
        {p.firstVisit && (
          <>
            <dt>First visit</dt>
            <dd>{fmtDate(p.firstVisit)}</dd>
          </>
        )}
        {p.followUp && (
          <>
            <dt>Follow-up</dt>
            <dd>
              {p.followUp === 'needed' ? 'Needs follow-up' : p.followUp === 'contacted' ? 'Contacted' : 'Done'}
              {p.followUpNotes ? ` — ${p.followUpNotes}` : ''}
            </dd>
          </>
        )}
        {p.notes && (
          <>
            <dt>Notes</dt>
            <dd>{p.notes}</dd>
          </>
        )}
      </dl>
      <h3>Attendance</h3>
      {perType.length === 0 ? (
        <p className="muted">No attendance recorded yet.</p>
      ) : (
        <table className="table compact">
          <tbody>
            {perType.map(({ t, st }) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="num">
                  {st.attended} of {st.possible}
                </td>
                <td className="num">
                  <b>{pct(st.attended, st.possible)}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {history.length > 0 && (
        <details>
          <summary>All {history.length} visits</summary>
          <ul className="plain">
            {history.map((e) => (
              <li key={e.id}>
                {fmtDate(e.date)} — {e.name || typeName(e.eventTypeId)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Modal>
  );
}

function FamilyList() {
  const { db } = useStore();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<Family | null>(null);
  const list = useMemo(() => {
    const qq = q.toLowerCase();
    return db.Families.filter((f) => {
      if (!qq) return true;
      if (f.name.toLowerCase().includes(qq)) return true;
      return db.FamilyMembers.some((m) => m.familyId === f.id && matchesSearch(db.People.find((p) => p.id === m.personId) ?? ({} as Person), q));
    }).sort((a, b) => a.name.localeCompare(b.name));
  }, [db, q]);

  return (
    <>
      <div className="toolbar">
        <SearchBox value={q} onChange={setQ} placeholder="Search families or members" />
        <div className="toolbar-row">
          <span className="muted small">{list.length} families</span>
          <span className="spacer" />
          <button className="btn sm primary" onClick={() => setEdit({ id: uid('f'), name: '', primaryAdultId: '', notes: '' })}>
            <Icon name="plus" size={16} /> New family
          </button>
        </div>
      </div>
      {list.length === 0 ? (
        <Empty>No families yet.</Empty>
      ) : (
        <ul className="people simple">
          {list.map((f) => {
            const mem = db.FamilyMembers.filter((m) => m.familyId === f.id)
              .map((m) => db.People.find((p) => p.id === m.personId))
              .filter((p): p is Person => !!p);
            const pa = mem.find((p) => p.id === f.primaryAdultId);
            return (
              <li key={f.id} className="person-row">
                <button className="row-main" onClick={() => setEdit(f)}>
                  <span className="who">
                    <span className="nm">
                      {f.name}
                      {pa ? <span className="muted"> · {pa.firstName}</span> : null}
                    </span>
                    <span className="tags">
                      <span className="desc">{mem.map((p) => p.firstName || displayName(p)).join(', ') || 'No members'}</span>
                    </span>
                  </span>
                  <span className="count-badge">{mem.length}</span>
                  <Icon name="chevron" size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {edit && <FamilyForm family={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function FamilyForm({ family, onClose }: { family: Family; onClose: () => void }) {
  const { db, saveFamily, deleteFamily } = useStore();
  const isNew = !db.Families.some((f) => f.id === family.id);
  const [f, setF] = useState(family);
  const [members, setMembers] = useState<string[]>(() => db.FamilyMembers.filter((m) => m.familyId === family.id).map((m) => m.personId));
  const [q, setQ] = useState('');
  const [confirmDel, setConfirmDel] = useState(false);
  const [adding, setAdding] = useState(false);
  const people = (ids: string[]) => ids.map((id) => db.People.find((p) => p.id === id)).filter((p): p is Person => !!p);
  const matches = q.trim() ? db.People.filter((p) => !members.includes(p.id) && matchesSearch(p, q)).slice(0, 8) : [];
  const adults = people(members).filter((p) => p.ageGroup === 'adult');

  const save = async () => {
    let name = f.name.trim();
    if (!name) name = people(members)[0]?.lastName || 'Family';
    const primary = f.primaryAdultId && members.includes(f.primaryAdultId) ? f.primaryAdultId : adults[0]?.id ?? '';
    await saveFamily({ ...f, name, primaryAdultId: primary }, members);
    onClose();
  };

  return (
    <Modal
      title={isNew ? 'New family' : `${family.name} family`}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button className="btn ghost danger-text" onClick={() => setConfirmDel(true)}>
              <Icon name="trash" /> Delete
            </button>
          )}
          <span className="spacer" />
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={save} disabled={!members.length && !f.name.trim()}>
            Save
          </button>
        </>
      }
    >
      <label className="field">
        <span>Family name (last name)</span>
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoCapitalize="words" />
      </label>
      <div className="field">
        <span>Primary adult</span>
        <div className="pill-row">
          {adults.length === 0 && <span className="muted small">Add an adult member first</span>}
          {adults.map((p) => (
            <button key={p.id} className={`pill ${f.primaryAdultId === p.id ? 'on' : ''}`} onClick={() => setF({ ...f, primaryAdultId: p.id })}>
              {displayName(p)}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Members ({members.length})</span>
        <ul className="plain members">
          {people(members).map((p) => (
            <li key={p.id}>
              <span>
                {displayName(p)} <AgeChip age={p.ageGroup} small />
              </span>
              <button className="icon-btn sm" aria-label="Remove" onClick={() => setMembers((m) => m.filter((x) => x !== p.id))}>
                <Icon name="x" size={16} />
              </button>
            </li>
          ))}
        </ul>
        <input placeholder="Add a member — search by name" value={q} onChange={(e) => setQ(e.target.value)} />
        {matches.length > 0 && (
          <div className="suggest">
            {matches.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setMembers((m) => [...m, p.id]);
                  setQ('');
                  if (!f.name.trim() && p.lastName) setF((x) => ({ ...x, name: p.lastName }));
                }}
              >
                {displayName(p)} · {p.ageGroup}
              </button>
            ))}
          </div>
        )}
        <button className="link" onClick={() => setAdding(true)}>
          + Create a new person in this family
        </button>
      </div>
      <label className="field">
        <span>Notes</span>
        <textarea rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      {adding && (
        <PersonForm
          title="New family member"
          defaults={{ lastName: f.name, category: 'regular', followUp: '' }}
          onClose={() => setAdding(false)}
          onSaved={(p) => setMembers((m) => [...m, p.id])}
        />
      )}
      {confirmDel && (
        <Confirm
          title="Delete family?"
          message="The family grouping is removed. The people in it are kept."
          onClose={() => setConfirmDel(false)}
          onConfirm={async () => {
            await deleteFamily(f.id);
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
