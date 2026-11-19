import type { RawRow, TableName } from './schema';

export interface Backend {
  kind: 'sheets' | 'demo';
  /** Creates any missing tabs / header columns. */
  init(): Promise<void>;
  loadAll(): Promise<Record<TableName, RawRow[]>>;
  /** Insert or update rows (matched on `id`). */
  upsert(table: TableName, rows: RawRow[]): Promise<void>;
  remove(table: TableName, ids: string[]): Promise<void>;
  userEmail(): string;
}
