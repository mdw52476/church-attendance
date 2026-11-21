// Read-only access to another spreadsheet (e.g. the old attendance sheet) with the signed-in user's token.
import { getToken } from './googleAuth';
import { extractSheetId } from './config';

const API = 'https://sheets.googleapis.com/v4/spreadsheets';

async function get(url: string) {
  const token = await getToken();
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    let msg = `Google Sheets error ${res.status}`;
    try {
      msg = (await res.json()).error?.message || msg;
    } catch {
      /* ignore */
    }
    if (res.status === 403) msg = `Your Google account can't open that sheet. Make sure it's shared with you. (${msg})`;
    if (res.status === 404) msg = "That sheet wasn't found. Check the link.";
    throw new Error(msg);
  }
  return res.json();
}

export async function listTabs(link: string): Promise<{ id: string; title: string; tabs: string[] }> {
  const id = extractSheetId(link);
  const j = await get(`${API}/${id}?fields=properties.title,sheets.properties.title`);
  return { id, title: j.properties?.title ?? '', tabs: (j.sheets ?? []).map((s: { properties: { title: string } }) => s.properties.title) };
}

export async function readTab(id: string, tab: string): Promise<string[][]> {
  const range = encodeURIComponent(`'${tab.replace(/'/g, "''")}'`);
  const j = await get(`${API}/${id}/values/${range}?valueRenderOption=FORMATTED_VALUE`);
  return (j.values ?? []).map((r: unknown[]) => r.map((c) => String(c ?? '')));
}
