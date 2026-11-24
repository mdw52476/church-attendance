import { useMemo, useState, type ReactNode } from 'react';
import { useStore } from '../data/store';
import { AGE_GROUPS, CATEGORIES, SECTIONS, type AgeGroup, type Person } from '../types';
import { addDays, addMonths, displayName, downloadFile, fmtDate, matchesSearch, pct, sortKey, toCsv, todayStr } from '../util';
import { AgeChip, CategoryChip, Empty, FilterChip, Icon, SearchBox, Segmented } from '../components/ui';
import { BarChart, Meter } from '../components/BarChart';
import { absentees, attendanceByEvent, filterEvents, monthKey, personStats, summarize } from '../logic/stats';
import { PersonDetail } from './People';

type Tab = 'overview' | 'people' | 'absent' | 'followup';
type Preset = '4w' | '3m' | '6m' | 'ytd' | '12m' | 'all' | 'custom';

function presetRange(p: Preset): { from: string; to: string } {
  const t = todayStr();
  switch (p) {
    case '4w':
      return { from: addDays(t, -27), to: t };
    case '3m':
      return { from: addMonths(t, -3), to: t };
    case '6m':
      return { from: addMonths(t, -6), to: t };
    case 'ytd':
      return { from: t.slice(0, 4) + '-01-01', to: t };
    case '12m':
      return { from: addMonths(t, -12), to: t };
    default:
      return { from: '', to: '' };
  }
}

export function Reports() {
  const { db } = useStore();
  const [tab, setTab] = useState<Tab>('overview');
  const [preset, setPreset] = useState<Preset>('3m');
  const [custom, setCustom] = useState(() => presetRange('3m'));
  const sunday = db.EventTypes.find((t) => t.kind === 'sunday');
  const [typeIds, setTypeIds] = useState<string[]>(sunday ? [sunday.id] : []);
  const range = preset === 'custom' ? custom : presetRange(preset);
  const events = useMemo(() => filterEvents(db, { ...range, typeIds }), [db, range.from, range.to, typeIds]);

  return (
    <div className="page reports">
      <div className="page-head">
        <h1>Reports</h1>
        <button className="btn sm ghost no-print" onClick={() => window.print()}>
          <Icon name="printer" size={16} /> Print
        </button>
      </div>
      <div className="no-print">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { id: 'overview', label: 'Totals' },
            { id: 'people', label: 'People' },
            { id: 'absent', label: 'Absent' },
            { id: 'followup', label: 'Follow-up' },
          ]}
        />
      </div>

      {tab !== 'followup' && (
        <div className="filters-panel no-print">
          <div className="chip-scroll" hidden={tab === 'absent'}>
            {(
              [
                ['4w', '4 weeks'],
                ['3m', '3 months'],
                ['6m', '6 months'],
                ['ytd', 'This year'],
                ['12m', '12 months'],
                ['all', 'All time'],
                ['custom', 'Custom'],
              ] as [Preset, string][]
            ).map(([id, l]) => (
              <FilterChip key={id} on={preset === id} onClick={() => setPreset(id)}>
                {l}
              </FilterChip>
            ))}
          </div>
          {preset === 'custom' && (
            <div className="row2">
              <label className="field">
                <span>From</span>
                <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
              </label>
              <label className="field">
                <span>To</span>
                <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
              </label>
            </div>
          )}
          <div className="chip-scroll">
            <FilterChip on={!typeIds.length} onClick={() => setTypeIds([])}>
              All events
            </FilterChip>
            {db.EventTypes.map((t) => (
              <FilterChip key={t.id} on={typeIds.includes(t.id)} onClick={() => setTypeIds((x) => (x.includes(t.id) ? x.filter((y) => y !== t.id) : [...x, t.id]))}>
                {t.name}
              </FilterChip>
            ))}
          </div>
        </div>
      )}
      <p className="print-only">
        {range.from ? `${fmtDate(range.from)} – ${fmtDate(range.to)}` : 'All time'} · {typeIds.length ? typeIds.map((id) => db.EventTypes.find((t) => t.id === id)?.name).join(', ') : 'All events'}
      </p>

      {tab === 'overview' && <Overview events={events} />}
      {tab === 'people' && <PeopleReport events={events} />}
      {tab === 'absent' && <Absentees typeIds={typeIds} />}
      {tab === 'followup' && <FollowUp />}
    </div>
  );
}

function Overview({ events }: { events: ReturnType<typeof filterEvents> }) {
  const { db } = useStore();
  const s = useMemo(() => summarize(db, events), [db, events]);
  const byEv = useMemo(() => attendanceByEvent(db), [db]);
  const typeName = (id: string) => db.EventTypes.find((t) => t.id === id)?.name ?? '';

  const perEvent = events.map((e) => {
    const named = byEv.get(e.id)?.length ?? 0;
    return {
      key: e.id,
      label: fmtDate(e.date, { month: 'numeric', day: 'numeric' }),
      value: named + e.anonCount,
      tip: `${e.name || typeName(e.eventTypeId)}`,
      detail: `${fmtDate(e.date)} · ${named} named${e.anonCount ? ` + ${e.anonCount} anon` : ''}`,
    };
  });

  const months = useMemo(() => {
    const m = new Map<string, { guests: Set<string>; total: number; events: number }>();
    for (const e of events) {
      const k = monthKey(e.date);
      if (!m.has(k)) m.set(k, { guests: new Set(), total: 0, events: 0 });
      const g = m.get(k)!;
      g.events++;
      g.total += (byEv.get(e.id)?.length ?? 0) + e.anonCount;
      for (const a of byEv.get(e.id) ?? []) if (a.category === 'first_time') g.guests.add(a.personId);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [events, byEv]);

  const exportCsv = () => {
    downloadFile(
      `attendance-summary-${todayStr()}.csv`,
      toCsv([
        ['Date', 'Event', 'Named', 'Anonymous', 'Total', 'Adult', 'Youth', 'Kids', 'Infant', 'First-time', 'Returning', 'Non-regular', 'Regular', 'Sec 1', 'Sec 2', 'Sec 3', 'Sec 4'],
        ...events.map((e) => {
          const rows = byEv.get(e.id) ?? [];
          const c = (f: (a: (typeof rows)[number]) => boolean) => rows.filter(f).length;
          return [
            e.date,
            e.name || typeName(e.eventTypeId),
            rows.length,
            e.anonCount,
            rows.length + e.anonCount,
            c((a) => a.ageGroup === 'adult'),
            c((a) => a.ageGroup === 'youth'),
            c((a) => a.ageGroup === 'kids'),
            c((a) => a.ageGroup === 'infant'),
            c((a) => a.category === 'first_time'),
            c((a) => a.category === 'returning'),
            c((a) => a.category === 'non_regular'),
            c((a) => a.category === 'regular'),
            ...SECTIONS.map((sec) => c((a) => a.section === sec)),
          ];
        }),
      ]),
    );
  };

  if (!events.length) return <Empty>No events in this range.</Empty>;

  const maxAge = Math.max(...AGE_GROUPS.map((a) => s.byAge[a.id].count));
  const maxCat = Math.max(...CATEGORIES.map((c) => s.byCat[c.id].count));
  const maxSec = Math.max(...[...SECTIONS, ''].map((x) => s.bySection[x].count));

  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <b>{s.total.toLocaleString()}</b>
          <span>Total attendance</span>
        </div>
        <div className="kpi">
          <b>{Math.round(s.avg)}</b>
          <span>Average per event</span>
        </div>
        <div className="kpi">
          <b>{s.events}</b>
          <span>Events</span>
        </div>
        <div className="kpi">
          <b>{s.unique}</b>
          <span>Different people</span>
        </div>
        <div className="kpi">
          <b>{s.newGuests}</b>
          <span>First-time guests</span>
        </div>
        <div className="kpi">
          <b>{s.anon}</b>
          <span>Anonymous</span>
        </div>
      </div>

      <div className="card">
        <h3>Attendance per event</h3>
        <BarChart bars={perEvent} ariaLabel="Total attendance per event" />
      </div>

      {months.length > 1 && (
        <div className="card">
          <h3>First-time guests per month</h3>
          <BarChart
            height={140}
            bars={months.map(([k, g]) => ({
              key: k,
              label: fmtDate(k + '-01', { month: 'short' }),
              value: g.guests.size,
              tip: 'first-time guests',
              detail: `${fmtDate(k + '-01', { month: 'long', year: 'numeric' })} · ${g.events} events, ${g.total} total attendance`,
            }))}
            ariaLabel="First-time guests per month"
          />
        </div>
      )}

      <div className="grid2">
        <div className="card">
          <h3>By age group</h3>
          <BreakdownTable
            rows={AGE_GROUPS.map((a) => ({ key: a.id, label: <AgeChip age={a.id} small />, count: s.byAge[a.id].count, unique: s.byAge[a.id].unique, cls: `age-${a.id}` }))}
            max={maxAge}
            events={s.events}
            total={s.named}
          />
        </div>
        <div className="card">
          <h3>By category</h3>
          <BreakdownTable
            rows={CATEGORIES.map((c) => ({ key: c.id, label: <CategoryChip cat={c.id} small showRegular />, count: s.byCat[c.id].count, unique: s.byCat[c.id].unique, cls: `cat-${c.id}` }))}
            max={maxCat}
            events={s.events}
            total={s.named}
          />
        </div>
        <div className="card">
          <h3>By section</h3>
          <BreakdownTable
            rows={[...SECTIONS, '']
              .filter((x) => x || s.bySection[''].count)
              .map((x) => ({ key: x || 'none', label: x ? `Section ${x}` : 'No section', count: s.bySection[x].count, unique: s.bySection[x].unique, cls: 'sec' }))}
            max={maxSec}
            events={s.events}
            total={s.named}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Events</h3>
          <button className="btn sm ghost no-print" onClick={exportCsv}>
            <Icon name="download" size={16} /> CSV
          </button>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Event</th>
                <th className="num">Total</th>
                {AGE_GROUPS.map((a) => (
                  <th key={a.id} className="num">
                    {a.label}
                  </th>
                ))}
                <th className="num">Guests</th>
              </tr>
            </thead>
            <tbody>
              {[...events].reverse().map((e) => {
                const rows = byEv.get(e.id) ?? [];
                return (
                  <tr key={e.id}>
                    <td>{fmtDate(e.date, { month: 'short', day: 'numeric', year: '2-digit' })}</td>
                    <td>{e.name || typeName(e.eventTypeId)}</td>
                    <td className="num">
                      <b>{rows.length + e.anonCount}</b>
                    </td>
                    {AGE_GROUPS.map((a) => (
                      <td key={a.id} className="num">
                        {rows.filter((r) => r.ageGroup === a.id).length}
                      </td>
                    ))}
                    <td className="num">{rows.filter((r) => r.category === 'first_time' || r.category === 'returning').length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function BreakdownTable({ rows, max, events, total }: { rows: { key: string; label: ReactNode; count: number; unique: number; cls: string }[]; max: number; events: number; total: number }) {
  return (
    <table className="table compact breakdown-table">
      <thead>
        <tr>
          <th />
          <th className="num">Attendance</th>
          <th className="num">Avg</th>
          <th className="num">People</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <td>
              <div className="bd-label">{r.label}</div>
              <Meter value={r.count} max={max} className={r.cls} />
            </td>
            <td className="num">
              {r.count} <span className="muted small">{pct(r.count, total)}</span>
            </td>
            <td className="num">{events ? Math.round((r.count / events) * 10) / 10 : 0}</td>
            <td className="num">{r.unique}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PeopleReport({ events }: { events: ReturnType<typeof filterEvents> }) {
  const { db } = useStore();
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'name' | 'rate' | 'count' | 'last'>('rate');
  const [ageF, setAgeF] = useState<AgeGroup[]>([]);
  const [showZero, setShowZero] = useState(false);
  const [detail, setDetail] = useState<Person | null>(null);
  const stats = useMemo(() => personStats(db, events), [db, events]);
  const list = useMemo(
    () =>
      stats
        .filter((s) => showZero || s.attended > 0)
        .filter((s) => s.person.status === 'active' || s.attended > 0)
        .filter((s) => matchesSearch(s.person, q))
        .filter((s) => !ageF.length || ageF.includes(s.person.ageGroup))
        .sort((a, b) => {
          if (sort === 'name') return sortKey(a.person, 'last').localeCompare(sortKey(b.person, 'last'));
          if (sort === 'count') return b.attended - a.attended;
          if (sort === 'last') return (b.last || '').localeCompare(a.last || '');
          return b.rate - a.rate || b.attended - a.attended;
        }),
    [stats, q, sort, ageF, showZero],
  );

  const exportCsv = () =>
    downloadFile(
      `attendance-by-person-${todayStr()}.csv`,
      toCsv([
        ['Name', 'Age group', 'Category', 'Section', 'Attended', 'Possible', 'Percent', 'Last attended', 'Phone', 'Email'],
        ...list.map((s) => [displayName(s.person, 'last'), s.person.ageGroup, s.person.category, s.person.section, s.attended, s.possible, s.possible ? Math.round(s.rate * 100) + '%' : '', s.last, s.person.phone, s.person.email]),
      ]),
    );

  if (!events.length) return <Empty>No events in this range.</Empty>;

  return (
    <>
      <div className="toolbar no-print">
        <SearchBox value={q} onChange={setQ} />
        <div className="chip-scroll wrap">
          {AGE_GROUPS.map((a) => (
            <FilterChip key={a.id} className={`age-${a.id}`} on={ageF.includes(a.id)} onClick={() => setAgeF((x) => (x.includes(a.id) ? x.filter((y) => y !== a.id) : [...x, a.id]))}>
              {a.label}
            </FilterChip>
          ))}
          <FilterChip on={showZero} onClick={() => setShowZero((x) => !x)}>
            Include 0 visits
          </FilterChip>
        </div>
        <div className="toolbar-row">
          <span className="muted small">
            {list.length} people · {events.length} events
          </span>
          <span className="spacer" />
          <button className="btn sm ghost" onClick={exportCsv}>
            <Icon name="download" size={16} /> CSV
          </button>
        </div>
      </div>
      <div className="table-wrap card">
        <table className="table people-table">
          <thead>
            <tr>
              <th>
                <button className={`th-btn ${sort === 'name' ? 'on' : ''}`} onClick={() => setSort('name')}>
                  Name
                </button>
              </th>
              <th className="num">
                <button className={`th-btn ${sort === 'count' ? 'on' : ''}`} onClick={() => setSort('count')}>
                  Visits
                </button>
              </th>
              <th className="num">
                <button className={`th-btn ${sort === 'rate' ? 'on' : ''}`} onClick={() => setSort('rate')}>
                  %
                </button>
              </th>
              <th className="num">
                <button className={`th-btn ${sort === 'last' ? 'on' : ''}`} onClick={() => setSort('last')}>
                  Last
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.person.id} onClick={() => setDetail(s.person)} className="clickable">
                <td>
                  <div>{displayName(s.person, 'last')}</div>
                  <div className="tags">
                    <AgeChip age={s.person.ageGroup} small />
                    <CategoryChip cat={s.person.category} small />
                  </div>
                </td>
                <td className="num">
                  {s.attended}/{s.possible}
                </td>
                <td className="num">
                  <b>{s.possible ? Math.round(s.rate * 100) + '%' : '—'}</b>
                  <Meter value={s.rate} max={1} />
                </td>
                <td className="num small">{s.last ? fmtDate(s.last, { month: 'short', day: 'numeric' }) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">% counts only events on or after each person's first visit.</p>
      {detail && <PersonDetail person={detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function Absentees({ typeIds }: { typeIds: string[] }) {
  const { db, updateFollowUp } = useStore();
  const [n, setN] = useState(3);
  const list = useMemo(() => absentees(db, typeIds, n, todayStr()), [db, typeIds, n]);
  const [detail, setDetail] = useState<Person | null>(null);
  const label = typeIds.length === 1 ? db.EventTypes.find((t) => t.id === typeIds[0])?.name : 'events';

  const exportCsv = () =>
    downloadFile(
      `absentees-${todayStr()}.csv`,
      toCsv([
        ['Name', 'Missed in a row', 'Last attended', 'Phone', 'Email', 'Follow-up'],
        ...list.map((a) => [displayName(a.person, 'last'), a.missed, a.last, a.person.phone, a.person.email, a.person.followUp]),
      ]),
    );

  return (
    <>
      <div className="toolbar-row no-print">
        <span>Regular attendees who missed the last</span>
        <select value={n} onChange={(e) => setN(Number(e.target.value))}>
          {[2, 3, 4, 5, 6, 8, 10, 12].map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <span>{label}</span>
        <span className="spacer" />
        <button className="btn sm ghost" onClick={exportCsv}>
          <Icon name="download" size={16} /> CSV
        </button>
      </div>
      <p className="print-only">
        Regular attendees who missed the last {n} {label}
      </p>
      {list.length === 0 ? (
        <Empty>Nobody has missed the last {n} in a row. 🎉</Empty>
      ) : (
        <ul className="people simple">
          {list.map((a) => (
            <li key={a.person.id} className="person-row">
              <button className="row-main" onClick={() => setDetail(a.person)}>
                <span className="who">
                  <span className="nm">{displayName(a.person, 'last')}</span>
                  <span className="tags">
                    <AgeChip age={a.person.ageGroup} small />
                    <span className="desc">
                      Missed {a.missed} in a row · last here {a.last ? fmtDate(a.last) : 'never'}
                    </span>
                  </span>
                </span>
              </button>
              {a.person.phone && (
                <a className="icon-btn" href={`tel:${a.person.phone}`} aria-label={`Call ${a.person.firstName}`}>
                  <Icon name="phone" size={18} />
                </a>
              )}
              <button
                className={`btn sm ${a.person.followUp === 'needed' ? 'flagged' : 'ghost'} no-print`}
                onClick={() => updateFollowUp(a.person, a.person.followUp === 'needed' ? '' : 'needed')}
              >
                <Icon name="flag" size={16} /> {a.person.followUp === 'needed' ? 'Flagged' : 'Flag'}
              </button>
            </li>
          ))}
        </ul>
      )}
      {detail && <PersonDetail person={db.People.find((p) => p.id === detail.id) ?? detail} onClose={() => setDetail(null)} />}
    </>
  );
}

function FollowUp() {
  const { db, updateFollowUp } = useStore();
  const [show, setShow] = useState<'open' | 'done'>('open');
  const [detail, setDetail] = useState<Person | null>(null);
  const list = useMemo(
    () =>
      db.People.filter((p) => (show === 'open' ? p.followUp === 'needed' || p.followUp === 'contacted' : p.followUp === 'done')).sort(
        (a, b) => (a.followUp === b.followUp ? (b.firstVisit || b.createdAt).localeCompare(a.firstVisit || a.createdAt) : a.followUp === 'needed' ? -1 : 1),
      ),
    [db.People, show],
  );

  const exportCsv = () =>
    downloadFile(
      `follow-up-${todayStr()}.csv`,
      toCsv([
        ['Name', 'Description', 'Category', 'Status', 'First visit', 'Phone', 'Email', 'Address', 'Notes'],
        ...list.map((p) => [displayName(p, 'last'), p.description, p.category, p.followUp, p.firstVisit, p.phone, p.email, p.address, p.followUpNotes]),
      ]),
    );

  return (
    <>
      <div className="toolbar-row no-print">
        <Segmented
          value={show}
          onChange={setShow}
          options={[
            { id: 'open', label: `To do (${db.People.filter((p) => p.followUp === 'needed' || p.followUp === 'contacted').length})` },
            { id: 'done', label: 'Done' },
          ]}
        />
        <span className="spacer" />
        <button className="btn sm ghost" onClick={exportCsv}>
          <Icon name="download" size={16} /> CSV
        </button>
      </div>
      {list.length === 0 ? (
        <Empty>{show === 'open' ? 'No one needs follow-up right now.' : 'Nothing marked done yet.'}</Empty>
      ) : (
        <ul className="people simple">
          {list.map((p) => (
            <li key={p.id} className="person-row followup-row">
              <button className="row-main" onClick={() => setDetail(p)}>
                <span className="who">
                  <span className="nm">{displayName(p, 'last')}</span>
                  <span className="tags">
                    <CategoryChip cat={p.category} small showRegular />
                    {p.followUp === 'contacted' && <span className="chip sm">Contacted</span>}
                    <span className="desc">
                      {p.firstVisit ? `First visit ${fmtDate(p.firstVisit)}` : ''}
                      {p.phone ? ` · ${p.phone}` : ''}
                    </span>
                  </span>
                  {p.followUpNotes && <span className="desc">{p.followUpNotes}</span>}
                </span>
              </button>
              <div className="row-actions no-print">
                {p.followUp === 'needed' && (
                  <button className="btn sm ghost" onClick={() => updateFollowUp(p, 'contacted')}>
                    Contacted
                  </button>
                )}
                {p.followUp !== 'done' ? (
                  <button className="btn sm" onClick={() => updateFollowUp(p, 'done')}>
                    <Icon name="check" size={16} /> Done
                  </button>
                ) : (
                  <button className="btn sm ghost" onClick={() => updateFollowUp(p, 'needed')}>
                    Reopen
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {detail && <PersonDetail person={db.People.find((x) => x.id === detail.id) ?? detail} onClose={() => setDetail(null)} />}
    </>
  );
}
