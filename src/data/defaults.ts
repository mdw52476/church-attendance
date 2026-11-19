import type { EventType } from '../types';

export function defaultEventTypes(): EventType[] {
  return [
    { id: 'et_sunday', name: 'Sunday Morning Service', kind: 'sunday', audience: 'all', dayOfWeek: '0', time: '10:30', active: true, sortOrder: 1 },
    { id: 'et_youth', name: 'Youth', kind: 'youth', audience: 'youth', dayOfWeek: '3', time: '18:30', active: true, sortOrder: 2 },
    { id: 'et_special', name: 'Special Event', kind: 'special', audience: 'all', dayOfWeek: '', time: '', active: true, sortOrder: 3 },
  ];
}
