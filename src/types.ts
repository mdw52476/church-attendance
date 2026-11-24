export type Category = 'regular' | 'non_regular' | 'first_time' | 'returning';
export type AgeGroup = 'adult' | 'youth' | 'kids' | 'infant';
export type FollowUp = '' | 'needed' | 'contacted' | 'done';

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  description: string;
  category: Category;
  categoryManual: boolean;
  ageGroup: AgeGroup;
  ageGroupManual: boolean;
  birthdate: string;
  section: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  followUp: FollowUp;
  followUpNotes: string;
  status: 'active' | 'inactive';
  firstVisit: string;
  createdAt: string;
  updatedAt: string;
}

export interface Family {
  id: string;
  name: string;
  primaryAdultId: string;
  notes: string;
}

export interface FamilyMember {
  id: string;
  familyId: string;
  personId: string;
}

export type EventKind = 'sunday' | 'special' | 'youth' | 'custom';

export interface EventType {
  id: string;
  name: string;
  kind: EventKind;
  audience: 'all' | 'youth';
  dayOfWeek: string; // '' or '0'..'6' (0 = Sunday)
  time: string;
  active: boolean;
  sortOrder: number;
}

export interface ChurchEvent {
  id: string;
  eventTypeId: string;
  date: string; // YYYY-MM-DD
  name: string;
  anonCount: number;
  anonNotes: string;
  notes: string;
  createdBy: string;
  createdAt: string;
  updatedBy: string;
  updatedAt: string;
}

export interface Attendance {
  id: string;
  eventId: string;
  personId: string;
  personName: string;
  category: Category;
  ageGroup: AgeGroup;
  section: string;
  checkedInBy: string;
  checkedInAt: string;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  entity: string;
  entityId: string;
  details: string;
}

export interface DB {
  People: Person[];
  Families: Family[];
  FamilyMembers: FamilyMember[];
  EventTypes: EventType[];
  Events: ChurchEvent[];
  Attendance: Attendance[];
  AuditLog: AuditEntry[];
}

export const AGE_GROUPS: { id: AgeGroup; label: string }[] = [
  { id: 'adult', label: 'Adult' },
  { id: 'youth', label: 'Youth' },
  { id: 'kids', label: 'Kids' },
  { id: 'infant', label: 'Infant' },
];

export const CATEGORIES: { id: Category; label: string }[] = [
  { id: 'regular', label: 'Regular' },
  { id: 'non_regular', label: 'Non-regular' },
  { id: 'returning', label: 'Returning guest' },
  { id: 'first_time', label: 'First-time guest' },
];

export const SECTIONS = ['1', '2', '3', '4'];

export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const ageLabel = (a: AgeGroup) => AGE_GROUPS.find((x) => x.id === a)?.label ?? a;
export const categoryLabel = (c: Category) => CATEGORIES.find((x) => x.id === c)?.label ?? c;
