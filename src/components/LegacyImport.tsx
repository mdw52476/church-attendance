import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { listTabs, readTab } from '../data/otherSheet';
import { buildLegacy, detectLayout, type LegacyLayout, type SpecialChoice } from '../logic/legacyImport';
import { fmtDate } from '../util';
import { Modal } from './ui';

type Step = 'link' | 'preview' | 'saving';

export function LegacyImport({ onClose }: { onClose: () => void }) {
  const { db, importData, reload, toast } = useStore();
  const [step, setStep] = useState<Step>('link');
  const [link, setLink] = useState('');
  const [sheet, setSheet] = useState<{ id: string; title: string; tabs: string[] } | null>(null);
  const [tab, setTab] = useState('');
  const [values, setValues] = useState<string[][] | null>(null);
  const [layout, setLayout] = useState<LegacyLayout | null>(null);
  const [specials, setSpecials] = useState<Record<number, SpecialChoice>>({});
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const sundayType = db.EventTypes.find((t) => t.kind === 'sunday');
  const specialType = db.EventTypes.find((t) => t.kind === 'special');

  const loadTabs = async () => {
    setErr('');
    setBusy('Opening sheet…');
    try {
      const s = await listTabs(link);
      setSheet(s);
      setTab(s.tabs.find((t) => /attendance/i.test(t)) ?? s.tabs[0] ?? '');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const loadTab = async () => {
    if (!sheet || !tab) return;
    setErr('');
    setBusy(`Reading “${tab}”…`);
    try {
      const v = await readTab(sheet.id, tab);
      const l = detectLayout(v);
      if (!l) throw new Error("Couldn't find a row of dates (like 11/15/26) at the top of that tab.");
      const sp: Record<number, SpecialChoice> = {};
      for (const c of l.columns)
        if (c.kind === 'special') {
          const friends = /fr.?giving|friendsgiving/i.test(c.header);
          sp[c.index] = { include: true, name: friends ? 'Friendsgiving' : c.header, date: friends ? '2026-11-17' : '' };
        }
      setValues(v);
      setLayout(l);
      setSpecials(sp);
      setStep('preview');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const result = useMemo(() => {
    if (!values || !layout || !sundayType || !specialType) return null;
    return buildLegacy(values, layout, {
      specials,
      sundayTypeId: sundayType.id,
      specialTypeId: specialType.id,
      existingPeople: db.People,
      existingEvents: db.Events,
    });
  }, [values, layout, specials, sundayType, specialType, db.People, db.Events]);

  const dates = layout?.columns.filter((c) => c.kind === 'date').map((c) => c.date).sort() ?? [];
  const missingSpecialDate = Object.values(specials).some((s) => s.include && !s.date);

  const doImport = async () => {
    if (!result) return;
    setStep('saving');
    setErr('');
    try {
      await importData(result.newPeople, result.families, result.members, result.events, result.attendance, setBusy);
      setBusy('Updating guest categories…');
      await reload();
      toast(`Imported ${result.newPeople.length} people, ${result.events.length} events and ${result.attendance.length} check-ins`);
      onClose();
    } catch (e) {
      setErr(`Import stopped: ${(e as Error).message}. Some rows may have been saved; check the sheet before trying again.`);
      setStep('preview');
      setBusy('');
    }
  };

  return (
    <Modal
      title="Import old attendance sheet"
      wide
      onClose={step === 'saving' ? () => {} : onClose}
      footer={
        step === 'link' ? (
          <>
            <span className="spacer" />
            {!sheet ? (
              <button className="btn primary" disabled={!link.trim() || !!busy} onClick={loadTabs}>
                {busy || 'Open sheet'}
              </button>
            ) : (
              <button className="btn primary" disabled={!tab || !!busy} onClick={loadTab}>
                {busy || 'Read this tab'}
              </button>
            )}
          </>
        ) : step === 'preview' ? (
          <>
            <button className="btn" onClick={() => setStep('link')}>
              Back
            </button>
            <span className="spacer" />
            <button className="btn primary" disabled={!result || missingSpecialDate || !result.events.length} onClick={doImport}>
              Import
            </button>
          </>
        ) : null
      }
    >
      {err && <div className="card notice error-card">{err}</div>}

      {step === 'link' && (
        <>
          <p>Brings in people, families and every Sunday from your original attendance spreadsheet. Your old sheet is only read, never changed.</p>
          <label className="field">
            <span>Link to the old sheet</span>
            <input
              value={link}
              placeholder="https://docs.google.com/spreadsheets/d/…"
              onChange={(e) => {
                setLink(e.target.value);
                setSheet(null);
              }}
            />
          </label>
          {sheet && (
            <label className="field">
              <span>Tab in “{sheet.title}”</span>
              <select value={tab} onChange={(e) => setTab(e.target.value)}>
                {sheet.tabs.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
          )}
        </>
      )}

      {step === 'preview' && result && layout && (
        <>
          {Object.entries(specials).map(([idx, s]) => {
            const col = layout.columns.find((c) => c.index === Number(idx))!;
            return (
              <div key={idx} className="card">
                <b>Column “{col.header}”</b> isn't a date. Import it as a special event?
                <label className="check-line">
                  <input type="checkbox" checked={s.include} onChange={(e) => setSpecials({ ...specials, [idx]: { ...s, include: e.target.checked } })} /> Import it
                </label>
                {s.include && (
                  <div className="row2">
                    <label className="field">
                      <span>Event name</span>
                      <input value={s.name} onChange={(e) => setSpecials({ ...specials, [idx]: { ...s, name: e.target.value } })} />
                    </label>
                    <label className="field">
                      <span>Date *</span>
                      <input type="date" value={s.date} onChange={(e) => setSpecials({ ...specials, [idx]: { ...s, date: e.target.value } })} />
                    </label>
                  </div>
                )}
              </div>
            );
          })}

          <div className="kpis">
            <div className="kpi">
              <b>{result.newPeople.length}</b>
              <span>
                People ({result.activeCount} active, {result.inactiveCount} inactive)
              </span>
            </div>
            <div className="kpi">
              <b>{result.families.length}</b>
              <span>Families</span>
            </div>
            <div className="kpi">
              <b>{result.events.length}</b>
              <span>Events</span>
            </div>
            <div className="kpi">
              <b>{result.attendance.length.toLocaleString()}</b>
              <span>Named check-ins</span>
            </div>
            <div className="kpi">
              <b>{result.anonymousTotal}</b>
              <span>Anonymous (to match sheet totals)</span>
            </div>
          </div>
          {dates.length > 0 && (
            <p className="muted small">
              Sundays from {fmtDate(dates[0])} to {fmtDate(dates[dates.length - 1])}.
            </p>
          )}
          {result.matchedExisting > 0 && <p className="small">{result.matchedExisting} people are already in the app and will get their history added instead of a duplicate.</p>}
          {result.notes.map((n) => (
            <p key={n} className="small">
              • {n}
            </p>
          ))}
          {result.skippedEvents.length > 0 && <p className="small">Already in the app, skipped: {result.skippedEvents.join(', ')}</p>}

          <details>
            <summary>{result.families.length} families</summary>
            <ul className="plain small">
              {result.families.map((f) => {
                const ids = result.members.filter((m) => m.familyId === f.id).map((m) => m.personId);
                const names = ids.map((id) => result.newPeople.find((p) => p.id === id) ?? db.People.find((p) => p.id === id)).map((p) => (p ? p.firstName || p.description : ''));
                return (
                  <li key={f.id}>
                    <b>{f.name}</b>: {names.join(', ')}
                  </li>
                );
              })}
            </ul>
          </details>
          <details>
            <summary>{result.placeholders.length} rows without a first name (imported as descriptions, inactive)</summary>
            <ul className="plain small">
              {result.placeholders.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </details>
          {result.merged.length > 0 && (
            <details>
              <summary>{result.merged.length} duplicate rows combined</summary>
              <ul className="plain small">
                {result.merged.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            </details>
          )}
          <details>
            <summary>All people</summary>
            <div className="table-wrap">
              <table className="table compact">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Age</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th className="num">Visits</th>
                  </tr>
                </thead>
                <tbody>
                  {result.newPeople.map((p) => (
                    <tr key={p.id}>
                      <td>{p.firstName || p.lastName ? `${p.lastName}${p.lastName && p.firstName ? ', ' : ''}${p.firstName}` : <i>{p.description}</i>}</td>
                      <td>{p.ageGroup}</td>
                      <td>{p.category.replace('_', '-')}</td>
                      <td>{p.status}</td>
                      <td className="num">{result.attendance.filter((a) => a.personId === p.id).length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="muted small">Nothing is saved until you tap Import. Large imports take about a minute.</p>
        </>
      )}

      {step === 'saving' && (
        <div className="splash">
          <p>
            <b>{busy || 'Saving…'}</b>
          </p>
          <p className="muted small">Keep this page open.</p>
        </div>
      )}
    </Modal>
  );
}
