// Table definitions. Each table is one tab in the Google Sheet; the first row is the header.
// Columns are matched by header name, so you can reorder or add your own columns in the sheet.

export type FieldType = 'string' | 'bool' | 'number';

export const SCHEMA = {
  People: {
    id: 'string',
    firstName: 'string',
    lastName: 'string',
    description: 'string',
    category: 'string',
    categoryManual: 'bool',
    ageGroup: 'string',
    ageGroupManual: 'bool',
    birthdate: 'string',
    section: 'string',
    phone: 'string',
    email: 'string',
    address: 'string',
    notes: 'string',
    followUp: 'string',
    followUpNotes: 'string',
    status: 'string',
    firstVisit: 'string',
    createdAt: 'string',
    updatedAt: 'string',
  },
  Families: {
    id: 'string',
    name: 'string',
    primaryAdultId: 'string',
    notes: 'string',
  },
  FamilyMembers: {
    id: 'string',
    familyId: 'string',
    personId: 'string',
  },
  EventTypes: {
    id: 'string',
    name: 'string',
    kind: 'string',
    audience: 'string',
    dayOfWeek: 'string',
    time: 'string',
    active: 'bool',
    sortOrder: 'number',
  },
  Events: {
    id: 'string',
    eventTypeId: 'string',
    date: 'string',
    name: 'string',
    anonCount: 'number',
    anonNotes: 'string',
    notes: 'string',
    createdBy: 'string',
    createdAt: 'string',
    updatedBy: 'string',
    updatedAt: 'string',
  },
  Attendance: {
    id: 'string',
    eventId: 'string',
    personId: 'string',
    personName: 'string',
    category: 'string',
    ageGroup: 'string',
    section: 'string',
    checkedInBy: 'string',
    checkedInAt: 'string',
  },
  AuditLog: {
    id: 'string',
    timestamp: 'string',
    user: 'string',
    action: 'string',
    entity: 'string',
    entityId: 'string',
    details: 'string',
  },
} as const satisfies Record<string, Record<string, FieldType>>;

export type TableName = keyof typeof SCHEMA;
export const TABLES = Object.keys(SCHEMA) as TableName[];

export type RawRow = Record<string, string>;

export function fromRaw<T>(table: TableName, raw: RawRow): T {
  const out: Record<string, unknown> = {};
  const cols = SCHEMA[table] as Record<string, FieldType>;
  for (const [k, t] of Object.entries(cols)) {
    const v = raw[k] ?? '';
    if (t === 'bool') out[k] = v === 'TRUE' || v === 'true' || v === '1' || v === 'yes';
    else if (t === 'number') out[k] = v === '' ? 0 : Number(v) || 0;
    else out[k] = String(v);
  }
  // keep any extra user-added columns untouched
  for (const [k, v] of Object.entries(raw)) if (!(k in out)) out[k] = v;
  return out as T;
}

export function toRaw(table: TableName, obj: object): RawRow {
  const out: RawRow = {};
  const cols = SCHEMA[table] as Record<string, FieldType>;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const t = cols[k];
    if (t === 'bool') out[k] = v ? 'TRUE' : 'FALSE';
    else out[k] = v == null ? '' : String(v);
  }
  return out;
}
