import type { Backend } from './backend';
import { AuthError, clearToken, getEmail, getToken } from './googleAuth';
import { SCHEMA, TABLES, type RawRow, type TableName } from './schema';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export class SheetsError extends Error {
  constructor(msg: string, public status: number) {
    super(msg);
  }
}

function colLetter(n: number) {
  // 0 -> A
  let s = '';
  n += 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

const q = (t: string) => `'${t.replace(/'/g, "''")}'`;

export class SheetsBackend implements Backend {
  kind = 'sheets' as const;
  private headers: Partial<Record<TableName, string[]>> = {};
  private sheetIds: Partial<Record<TableName, number>> = {};

  constructor(private spreadsheetId: string) {}

  userEmail() {
    return getEmail();
  }

  private async call(path: string, init: RequestInit = {}, retry = true): Promise<any> {
    const token = await getToken();
    const res = await fetch(`${API}/${this.spreadsheetId}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });
    if (res.status === 401 && retry) {
      clearToken();
      return this.call(path, init, false);
    }
    if (res.status === 401) throw new AuthError('Your Google sign-in expired. Please sign in again.');
    if (!res.ok) {
      let msg = `Google Sheets error ${res.status}`;
      try {
        const j = await res.json();
        msg = j.error?.message || msg;
      } catch {
        /* ignore */
      }
      const google = msg;
      if (/insufficient authentication scopes/i.test(google)) {
        clearToken();
        throw new AuthError(
          "Google didn't give this app permission to use your spreadsheets. Tap “Sign in again” and, on Google's permission screen, make sure the box for “See, edit, create, and delete all your Google Sheets spreadsheets” is ticked.",
        );
      }
      if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(google)) {
        msg = "The Google Sheets API isn't turned on for your Google Cloud project yet. In console.cloud.google.com, search “Google Sheets API” and click Enable, wait a minute, then tap Try again.";
      } else if (res.status === 403) {
        msg = `You (${getEmail() || 'this Google account'}) don't have access to this Google Sheet. Ask the owner to share it with you as Editor. Google said: ${google}`;
      } else if (res.status === 404) msg = 'Google Sheet not found. Check the sheet link in Setup.';
      throw new SheetsError(msg, res.status);
    }
    return res.status === 204 ? null : res.json();
  }

  async init() {
    const meta = await this.call('?fields=sheets.properties(sheetId,title)');
    const existing = new Map<string, number>(meta.sheets.map((s: any) => [s.properties.title, s.properties.sheetId]));
    const missing = TABLES.filter((t) => !existing.has(t));
    if (missing.length) {
      const r = await this.call(':batchUpdate', {
        method: 'POST',
        body: JSON.stringify({
          requests: missing.map((title) => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })),
        }),
      });
      for (const rep of r.replies) existing.set(rep.addSheet.properties.title, rep.addSheet.properties.sheetId);
    }
    for (const t of TABLES) this.sheetIds[t] = existing.get(t);

    // Read header rows and add any missing columns
    const hdr = await this.call(`/values:batchGet?${TABLES.map((t) => 'ranges=' + encodeURIComponent(`${q(t)}!1:1`)).join('&')}`);
    const updates: { range: string; values: string[][] }[] = [];
    hdr.valueRanges.forEach((vr: any, i: number) => {
      const t = TABLES[i];
      const have: string[] = (vr.values?.[0] || []).map((h: string) => String(h).trim());
      const want = Object.keys(SCHEMA[t]);
      const merged = [...have];
      for (const c of want) if (!merged.includes(c)) merged.push(c);
      this.headers[t] = merged;
      if (merged.length !== have.length) updates.push({ range: `${q(t)}!A1`, values: [merged] });
    });
    if (updates.length) {
      await this.call('/values:batchUpdate', {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
      });
    }
  }

  async loadAll() {
    const r = await this.call(`/values:batchGet?valueRenderOption=FORMATTED_VALUE&${TABLES.map((t) => 'ranges=' + encodeURIComponent(q(t))).join('&')}`);
    const out = {} as Record<TableName, RawRow[]>;
    r.valueRanges.forEach((vr: any, i: number) => {
      const t = TABLES[i];
      const rows: string[][] = vr.values || [];
      const header = (rows[0] || this.headers[t] || []).map((h) => String(h).trim());
      this.headers[t] = header;
      out[t] = rows
        .slice(1)
        .map((row) => {
          const o: RawRow = {};
          header.forEach((h, j) => (o[h] = row[j] != null ? String(row[j]) : ''));
          return o;
        })
        .filter((o) => o.id);
    });
    return out;
  }

  /** Fresh id → row-number map (re-read every write so edits from another device can't misalign rows). */
  private async rowMap(table: TableName): Promise<Map<string, number>> {
    const idCol = colLetter(this.headers[table]!.indexOf('id'));
    const r = await this.call(`/values/${encodeURIComponent(`${q(table)}!${idCol}:${idCol}`)}`);
    const m = new Map<string, number>();
    (r.values || []).forEach((v: string[], i: number) => {
      if (i > 0 && v[0]) m.set(String(v[0]), i + 1);
    });
    return m;
  }

  private toRow(table: TableName, raw: RawRow): string[] {
    return this.headers[table]!.map((h) => raw[h] ?? '');
  }

  async upsert(table: TableName, rows: RawRow[]) {
    if (!rows.length) return;
    const map = await this.rowMap(table);
    const header = this.headers[table]!;
    const last = colLetter(header.length - 1);
    const updates: { range: string; values: string[][] }[] = [];
    const appends: string[][] = [];
    for (const r of rows) {
      const n = map.get(r.id);
      if (n) updates.push({ range: `${q(table)}!A${n}:${last}${n}`, values: [this.toRow(table, r)] });
      else appends.push(this.toRow(table, r));
    }
    if (updates.length) {
      await this.call('/values:batchUpdate', {
        method: 'POST',
        body: JSON.stringify({ valueInputOption: 'RAW', data: updates }),
      });
    }
    if (appends.length) {
      await this.call(`/values/${encodeURIComponent(`${q(table)}!A1`)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
        method: 'POST',
        body: JSON.stringify({ values: appends }),
      });
    }
  }

  async remove(table: TableName, ids: string[]) {
    if (!ids.length) return;
    const map = await this.rowMap(table);
    const rowsDesc = ids
      .map((id) => map.get(id))
      .filter((n): n is number => !!n)
      .sort((a, b) => b - a);
    if (!rowsDesc.length) return;
    await this.call(':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({
        requests: rowsDesc.map((n) => ({
          deleteDimension: { range: { sheetId: this.sheetIds[table], dimension: 'ROWS', startIndex: n - 1, endIndex: n } },
        })),
      }),
    });
  }
}
