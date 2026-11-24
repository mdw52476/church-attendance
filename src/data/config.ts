// App configuration. Values come from public/config.json (edit that file before deploying),
// and can be overridden per-device on the Setup screen (saved in this browser only).

export interface AppConfig {
  googleClientId: string;
  spreadsheetId: string;
  churchName: string;
  shortName: string;
}

const LS_KEY = 'ca.config';

let fileConfig: AppConfig = { googleClientId: '', spreadsheetId: '', churchName: 'Church Attendance', shortName: '' };

export async function loadConfig(): Promise<AppConfig> {
  try {
    const res = await fetch('./config.json', { cache: 'no-store' });
    if (res.ok) fileConfig = { ...fileConfig, ...(await res.json()) };
  } catch {
    /* offline or missing: fall back to defaults */
  }
  return getConfig();
}

export function getConfig(): AppConfig {
  let local: Partial<AppConfig> = {};
  try {
    local = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    /* ignore */
  }
  const pick = (k: keyof AppConfig) => (local[k] && String(local[k]).trim()) || fileConfig[k];
  return { googleClientId: pick('googleClientId'), spreadsheetId: pick('spreadsheetId'), churchName: pick('churchName'), shortName: pick('shortName') };
}

export function saveLocalConfig(c: Partial<AppConfig>) {
  try {
    const cur = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    localStorage.setItem(LS_KEY, JSON.stringify({ ...cur, ...c }));
  } catch {
    /* ignore */
  }
}

/** Accepts a full Google Sheets URL or a bare ID. */
export function extractSheetId(input: string): string {
  const m = input.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return (m ? m[1] : input).trim();
}
