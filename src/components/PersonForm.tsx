import { useMemo, useState } from 'react';
import { newPerson, useStore } from '../data/store';
import { AGE_GROUPS, CATEGORIES, SECTIONS, type Person } from '../types';
import { ageGroupFromBirthdate, gradeFromBirthdate } from '../logic/rules';
import { displayName, uid } from '../util';
import { Confirm, Icon, Modal } from './ui';

interface Props {
  person?: Person;
  defaults?: Partial<Person>;
  title?: string;
  onClose: () => void;
  onSaved?: (p: Person) => void;
}

export function PersonForm({ person, defaults, title, onClose, onSaved }: Props) {
  const { db, savePerson, saveFamily, deletePerson, savePeople, toast } = useStore();
  const isNew = !person;
  const [p, setP] = useState<Person>(() => person ?? newPerson({ category: 'first_time', followUp: 'needed', ...defaults }));
  const [unknownName, setUnknownName] = useState(() => !!person && !person.firstName && !person.lastName && !!person.description);
  const initialFams = useMemo(() => (person ? db.FamilyMembers.filter((m) => m.personId === person.id).map((m) => m.familyId) : []), [person, db.FamilyMembers]);
  const [famIds, setFamIds] = useState<string[]>(initialFams);
  const [famQuery, setFamQuery] = useState('');
  const [newFam, setNewFam] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [showMore, setShowMore] = useState(!isNew);

  const set = <K extends keyof Person>(k: K, v: Person[K]) => setP((x) => ({ ...x, [k]: v }));

  const autoAge = p.birthdate ? ageGroupFromBirthdate(p.birthdate) : null;
  const grade = p.birthdate ? gradeFromBirthdate(p.birthdate) : '';

  const famMatches = useMemo(() => {
    const qq = famQuery.trim().toLowerCase();
    if (!qq) return [];
    return db.Families.filter((f) => !famIds.includes(f.id) && f.name.toLowerCase().includes(qq)).slice(0, 6);
  }, [famQuery, db.Families, famIds]);

  const famName = (id: string) => {
    const f = db.Families.find((x) => x.id === id);
    if (!f) return '';
    const pa = db.People.find((x) => x.id === f.primaryAdultId);
    return pa ? `${f.name} (${pa.firstName})` : f.name;
  };

  const canSave = unknownName ? p.description.trim() !== '' : p.firstName.trim() !== '' || p.lastName.trim() !== '';

  // Everyone else in this person's families whose category differs — candidates for "apply to whole family"
  const [applyToFamily, setApplyToFamily] = useState(false);
  const familyOthers = useMemo(() => {
    const ids = new Set(db.FamilyMembers.filter((m) => famIds.includes(m.familyId) && m.personId !== p.id).map((m) => m.personId));
    return db.People.filter((x) => ids.has(x.id));
  }, [db.FamilyMembers, db.People, famIds, p.id]);
  const othersToChange = familyOthers.filter((x) => x.category !== p.category);
  const categoryLabelText = CATEGORIES.find((c) => c.id === p.category)?.label ?? p.category;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      const toSave = unknownName ? { ...p, firstName: '', lastName: '' } : p;
      const saved = await savePerson(toSave);
      // family memberships
      const ids = [...famIds];
      if (newFam && saved.lastName) {
        const fid = uid('f');
        await saveFamily({ id: fid, name: saved.lastName, primaryAdultId: saved.ageGroup === 'adult' ? saved.id : '', notes: '' }, [saved.id]);
        ids.push(fid);
      }
      const before = new Set(initialFams);
      const after = new Set(ids);
      for (const fid of ids) {
        if (before.has(fid) || (newFam && !db.Families.some((f) => f.id === fid))) continue;
        const f = db.Families.find((x) => x.id === fid)!;
        const members = db.FamilyMembers.filter((m) => m.familyId === fid).map((m) => m.personId);
        await saveFamily(f, [...members, saved.id]);
      }
      for (const fid of initialFams) {
        if (after.has(fid)) continue;
        const f = db.Families.find((x) => x.id === fid);
        if (!f) continue;
        const members = db.FamilyMembers.filter((m) => m.familyId === fid && m.personId !== saved.id).map((m) => m.personId);
        await saveFamily(f, members);
      }
      if (applyToFamily && othersToChange.length) {
        await savePeople(
          othersToChange.map((x) => ({ ...x, category: saved.category, categoryManual: true })),
          `Set ${othersToChange.length} family member(s) of ${displayName(saved)} to ${categoryLabelText}`,
        );
        toast(`${othersToChange.length + 1} people set to ${categoryLabelText}`);
      }
      onSaved?.(saved);
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title ?? (isNew ? 'Add person' : 'Edit person')}
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
          <button className="btn primary" disabled={!canSave || busy} onClick={save}>
            {busy ? 'Saving…' : isNew ? 'Add' : 'Save'}
          </button>
        </>
      }
    >
      <label className="check-line">
        <input type="checkbox" checked={unknownName} onChange={(e) => setUnknownName(e.target.checked)} /> Don't know their name yet
      </label>

      {unknownName ? (
        <label className="field">
          <span>Description *</span>
          <textarea rows={2} autoFocus value={p.description} placeholder="e.g. Young couple with a baby, sat in section 3" onChange={(e) => set('description', e.target.value)} />
        </label>
      ) : (
        <div className="row2">
          <label className="field">
            <span>First name</span>
            <input autoFocus value={p.firstName} onChange={(e) => set('firstName', e.target.value)} autoCapitalize="words" />
          </label>
          <label className="field">
            <span>Last name</span>
            <input value={p.lastName} onChange={(e) => set('lastName', e.target.value)} autoCapitalize="words" />
          </label>
        </div>
      )}

      <div className="field">
        <span>
          Category {p.categoryManual ? <em className="muted">(set by hand)</em> : <em className="muted">(updates automatically)</em>}
        </span>
        <div className="pill-row">
          {CATEGORIES.map((c) => (
            <button key={c.id} type="button" className={`pill cat-${c.id} ${p.category === c.id ? 'on' : ''}`} onClick={() => setP((x) => ({ ...x, category: c.id, categoryManual: !isNew || x.categoryManual }))}>
              {c.label}
            </button>
          ))}
        </div>
        {p.categoryManual && (
          <button type="button" className="link" onClick={() => set('categoryManual', false)}>
            Let the app update this automatically
          </button>
        )}
        {othersToChange.length > 0 && (
          <label className="check-line apply-family">
            <input type="checkbox" checked={applyToFamily} onChange={(e) => setApplyToFamily(e.target.checked)} />
            <span>
              Also make the rest of the family <b>{categoryLabelText}</b>
              <span className="muted small"> ({othersToChange.map((x) => x.firstName || displayName(x)).join(', ')})</span>
            </span>
          </label>
        )}
      </div>

      <div className="field">
        <span>Age group {autoAge && !p.ageGroupManual ? <em className="muted">(from birthdate)</em> : p.ageGroupManual ? <em className="muted">(set by hand)</em> : null}</span>
        <div className="pill-row">
          {AGE_GROUPS.map((a) => (
            <button
              key={a.id}
              type="button"
              className={`pill age-${a.id} ${(autoAge && !p.ageGroupManual ? autoAge : p.ageGroup) === a.id ? 'on' : ''}`}
              onClick={() => setP((x) => ({ ...x, ageGroup: a.id, ageGroupManual: !!x.birthdate }))}
            >
              {a.label}
            </button>
          ))}
        </div>
        {p.ageGroupManual && p.birthdate && (
          <button type="button" className="link" onClick={() => set('ageGroupManual', false)}>
            Use birthdate to set this automatically
          </button>
        )}
      </div>

      <div className="field">
        <span>Usual section</span>
        <div className="pill-row">
          {['', ...SECTIONS].map((s) => (
            <button key={s || 'none'} type="button" className={`pill ${p.section === s ? 'on' : ''}`} onClick={() => set('section', s)}>
              {s || 'None'}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Families</span>
        <div className="pill-row">
          {famIds.map((id) => (
            <span key={id} className="pill on removable">
              {famName(id)}
              <button type="button" aria-label="Remove from family" onClick={() => setFamIds((x) => x.filter((y) => y !== id))}>
                <Icon name="x" size={14} />
              </button>
            </span>
          ))}
        </div>
        <input placeholder="Add to a family… (type last name)" value={famQuery} onChange={(e) => setFamQuery(e.target.value)} />
        {famMatches.length > 0 && (
          <div className="suggest">
            {famMatches.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFamIds((x) => [...x, f.id]);
                  setFamQuery('');
                }}
              >
                {famName(f.id)} · {db.FamilyMembers.filter((m) => m.familyId === f.id).length} people
              </button>
            ))}
          </div>
        )}
        {!unknownName && p.lastName.trim() && (
          <label className="check-line">
            <input type="checkbox" checked={newFam} onChange={(e) => setNewFam(e.target.checked)} /> Start a new “{p.lastName.trim()}” family
          </label>
        )}
      </div>

      {!showMore ? (
        <button type="button" className="link" onClick={() => setShowMore(true)}>
          + Birthdate, contact info, follow-up, notes
        </button>
      ) : (
        <>
          <div className="row2">
            <label className="field">
              <span>Birthdate {grade && <em className="muted">· {grade}</em>}</span>
              <input type="date" value={p.birthdate} onChange={(e) => set('birthdate', e.target.value)} />
            </label>
            <label className="field">
              <span>Phone</span>
              <input type="tel" value={p.phone} onChange={(e) => set('phone', e.target.value)} />
            </label>
          </div>
          <label className="field">
            <span>Email</span>
            <input type="email" value={p.email} onChange={(e) => set('email', e.target.value)} />
          </label>
          <label className="field">
            <span>Address</span>
            <input value={p.address} onChange={(e) => set('address', e.target.value)} />
          </label>
          {!unknownName && (
            <label className="field">
              <span>Description</span>
              <input value={p.description} placeholder="Helps you recognize them" onChange={(e) => set('description', e.target.value)} />
            </label>
          )}
          <div className="field">
            <span>Follow-up</span>
            <div className="pill-row">
              {(
                [
                  ['', 'None'],
                  ['needed', 'Needs follow-up'],
                  ['contacted', 'Contacted'],
                  ['done', 'Done'],
                ] as const
              ).map(([v, l]) => (
                <button key={v || 'none'} type="button" className={`pill ${p.followUp === v ? 'on' : ''}`} onClick={() => set('followUp', v)}>
                  {l}
                </button>
              ))}
            </div>
            <textarea rows={2} placeholder="Follow-up notes" value={p.followUpNotes} onChange={(e) => set('followUpNotes', e.target.value)} />
          </div>
          <label className="field">
            <span>Notes</span>
            <textarea rows={2} value={p.notes} onChange={(e) => set('notes', e.target.value)} />
          </label>
          <label className="check-line">
            <input type="checkbox" checked={p.status === 'inactive'} onChange={(e) => set('status', e.target.checked ? 'inactive' : 'active')} /> Inactive (hide from check-in, keep history)
          </label>
        </>
      )}

      {confirmDel && (
        <Confirm
          title="Delete person?"
          message={
            <>
              This permanently removes <b>{displayName(p)}</b> and all of their attendance records. To keep their history, mark them <b>Inactive</b> instead.
            </>
          }
          onClose={() => setConfirmDel(false)}
          onConfirm={async () => {
            await deletePerson(p.id);
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
