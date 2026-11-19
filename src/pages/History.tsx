import { useMemo, useState } from 'react';
import { useStore } from '../data/store';
import { AGE_GROUPS, CATEGORIES, type ChurchEvent } from '../types';
import { displayName, downloadFile, fmtDate, fmtDateTime, sortKey, toCsv } from '../util';
import { AgeChip, CategoryChip, Confirm, Empty, FilterChip, Icon, Modal, SectionBadge } from '../components/ui';
import { summarize } from '../logic/stats';

export function History({ onNavigate }: { onNavigate: (p: string) => void }) {
  const { db } = useStore();
  const [typeF, setTypeF] = useState<string[]>([]);
  const [open, setOpen] = useState<ChurchEvent | null>(null);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of db.Attendance) m.set(a.eventId, (m.get(a.eventId) ?? 0) + 1);
    return m;
  }, [db.Attendance]);
  const events = useMemo(
    () => db.Events.filter((e) => !typeF.length || typeF.includes(e.eventTypeId)).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt)),
    [db.Events, typeF],
  );
  const byMonth = useMemo(() => {
    const g: { key: string; list: ChurchEvent[] }[] = [];
    for (const e of events) {
      const k = e.date.slice(0, 7);
      if (!g.length || g[g.length - 1].key !== k) g.push({ key: k, list: [] });
      g[g.length - 1].list.push(e);
    }
    return g;
  }, [events]);
  const typeName = (id: string) => db.EventTypes.find((t) => t.id === id)?.name ?? 'Event';

  return (
    <div className="page">
      <div className="page-head">
        <h1>Past events</h1>
      </div>
      <div className="chip-scroll wrap">
        {db.EventTypes.map((t) => (
          <FilterChip key={t.id} on={typeF.includes(t.id)} onClick={() => setTypeF((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))}>
            {t.name}
          </FilterChip>
        ))}
      </div>
      {events.length === 0 ? (
        <Empty>No events saved yet. Take attendance on the Check-in tab.</Empty>
      ) : (
        byMonth.map((g) => (
          <section key={g.key}>
            <h3 className="month-head">{fmtDate(g.key + '-01', { month: 'long', year: 'numeric' })}</h3>
            <ul className="people simple">
              {g.list.map((e) => (
                <li key={e.id} className="person-row">
                  <button className="row-main" onClick={() => setOpen(e)}>
                    <span className="date-badge">
                      <b>{fmtDate(e.date, { day: 'numeric' })}</b>
                      <span>{fmtDate(e.date, { weekday: 'short' })}</span>
                    </span>
                    <span className="who">
                      <span className="nm">{e.name || typeName(e.eventTypeId)}</span>
                      <span className="tags">
                        <span className="desc">
                          {e.name ? typeName(e.eventTypeId) + ' · ' : ''}
                          {counts.get(e.id) ?? 0} named{e.anonCount ? ` + ${e.anonCount} anonymous` : ''}
                        </span>
                      </span>
                    </span>
                    <span className="count-badge big">{(counts.get(e.id) ?? 0) + e.anonCount}</span>
                    <Icon name="chevron" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
      {open && <EventDetail event={open} onClose={() => setOpen(null)} onEdit={() => onNavigate(`/checkin?event=${open.id}`)} />}
    </div>
  );
}

function EventDetail({ event: e, onClose, onEdit }: { event: ChurchEvent; onClose: () => void; onEdit: () => void }) {
  const { db, deleteEvent } = useStore();
  const [confirmDel, setConfirmDel] = useState(false);
  const typeName = db.EventTypes.find((t) => t.id === e.eventTypeId)?.name ?? 'Event';
  const s = useMemo(() => summarize(db, [e]), [db, e]);
  const rows = useMemo(() => {
    const people = new Map(db.People.map((p) => [p.id, p]));
    return db.Attendance.filter((a) => a.eventId === e.id)
      .map((a) => ({ a, p: people.get(a.personId) }))
      .sort((x, y) => (x.p && y.p ? sortKey(x.p, 'last').localeCompare(sortKey(y.p, 'last')) : 0));
  }, [db, e.id]);
  const log = db.AuditLog.filter((l) => l.entity === 'event' && l.entityId === e.id).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const title = e.name || typeName;

  const exportCsv = () =>
    downloadFile(
      `attendance-${e.date}-${title.replace(/\W+/g, '-').toLowerCase()}.csv`,
      toCsv([
        ['Name', 'Age group', 'Category (at the time)', 'Section', 'Checked in by', 'Checked in at'],
        ...rows.map(({ a, p }) => [p ? displayName(p, 'last') : a.personName, a.ageGroup, a.category, a.section, a.checkedInBy, a.checkedInAt]),
        [],
        ['Anonymous headcount', String(e.anonCount), e.anonNotes],
        ['Total', String(rows.length + e.anonCount)],
      ]),
    );

  return (
    <Modal
      title={title}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn ghost danger-text" onClick={() => setConfirmDel(true)}>
            <Icon name="trash" size={16} />
          </button>
          <span className="spacer" />
          <button className="btn ghost" onClick={() => window.print()}>
            <Icon name="printer" size={16} /> Print
          </button>
          <button className="btn ghost" onClick={exportCsv}>
            <Icon name="download" size={16} /> CSV
          </button>
          <button className="btn primary" onClick={onEdit}>
            <Icon name="edit" size={16} /> Edit
          </button>
        </>
      }
    >
      <div className="print-area">
        <p className="muted">
          {fmtDate(e.date, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          {e.name ? ` · ${typeName}` : ''}
        </p>
        <div className="kpis">
          <div className="kpi">
            <b>{s.total}</b>
            <span>Total</span>
          </div>
          <div className="kpi">
            <b>{s.named}</b>
            <span>Named</span>
          </div>
          <div className="kpi">
            <b>{s.anon}</b>
            <span>Anonymous</span>
          </div>
        </div>
        <div className="breakdown">
          {AGE_GROUPS.map((a) => (
            <span key={a.id} className={`chip age-${a.id}`}>
              {a.label}: {s.byAge[a.id].count}
            </span>
          ))}
          {CATEGORIES.filter((c) => c.id !== 'regular').map((c) => (
            <span key={c.id} className={`chip cat-${c.id}`}>
              {c.label}: {s.byCat[c.id].count}
            </span>
          ))}
        </div>
        {e.anonNotes && <p className="muted small">Anonymous: {e.anonNotes}</p>}
        {e.notes && <p>{e.notes}</p>}
        <ul className="people simple compact">
          {rows.map(({ a, p }) => (
            <li key={a.id} className="person-row">
              <div className="row-main static">
                <span className="who">
                  <span className="nm">{p ? displayName(p, 'last') : a.personName || '(removed person)'}</span>
                  <span className="tags">
                    <AgeChip age={a.ageGroup} small />
                    <CategoryChip cat={a.category} small />
                  </span>
                </span>
                <SectionBadge section={a.section} />
              </div>
            </li>
          ))}
        </ul>
        {log.length > 0 && (
          <details className="audit">
            <summary>Change history ({log.length})</summary>
            <ul className="plain small">
              {log.map((l) => (
                <li key={l.id}>
                  <b>{fmtDateTime(l.timestamp)}</b> · {l.user || 'unknown'} · {l.action}: {l.details}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {confirmDel && (
        <Confirm
          title="Delete this event?"
          message={`This permanently deletes the event and its ${rows.length} attendance records.`}
          onClose={() => setConfirmDel(false)}
          onConfirm={async () => {
            await deleteEvent(e.id);
            onClose();
          }}
        />
      )}
    </Modal>
  );
}
