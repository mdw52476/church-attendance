// Sign-in.
//
// Two modes:
//  • "server" (the live site on Vercel): volunteers sign in with their name + the church passcode
//    (/api/auth/login) and stay signed in via an encrypted HttpOnly cookie. The app reaches the
//    Google Sheet as the church's service account; it fetches a fresh 1-hour access token from
//    /api/auth/token whenever it needs one.
//  • "browser" (fallback, e.g. `npm run dev` on your computer, or before the server is configured):
//    personal Google sign-in popup; the access token lasts about an hour.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
  }
}

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets openid email profile';
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const LS_TOKEN = 'ca.token';
const LS_EMAIL = 'ca.email';

interface StoredToken {
  token: string;
  expires: number;
}

let mode: 'server' | 'browser' = 'browser';
let tokenClient: any = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
let current: StoredToken | null = null;
let clientIdForRefresh = '';

try {
  current = JSON.parse(localStorage.getItem(LS_TOKEN) || 'null');
} catch {
  current = null;
}

export class AuthError extends Error {}

function store(token: string, expiresIn: number) {
  current = { token, expires: Date.now() + (Number(expiresIn) - 60) * 1000 };
  try {
    localStorage.setItem(LS_TOKEN, JSON.stringify(current));
  } catch {
    /* ignore */
  }
}

function setEmail(email: string) {
  if (!email) return;
  try {
    localStorage.setItem(LS_EMAIL, email);
  } catch {
    /* ignore */
  }
}

export function getEmail() {
  try {
    return localStorage.getItem(LS_EMAIL) || '';
  } catch {
    return '';
  }
}

export function isServerMode() {
  return mode === 'server';
}

/** Asks the server for a fresh token. Returns null when signed out. Throws if the server isn't usable. */
async function serverToken(): Promise<string | null> {
  const r = await fetch('/api/auth/token', { cache: 'no-store', credentials: 'same-origin' });
  const isJson = (r.headers.get('content-type') || '').includes('application/json');
  if (!isJson || r.status === 404 || r.status === 503) throw new Error('server sign-in unavailable');
  if (r.status === 401) return null;
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new AuthError(`Couldn't connect to Google Sheets: ${j.message || j.error || r.status}`);
  }
  const j = await r.json();
  store(j.access_token, j.expires_in);
  setEmail(j.name);
  try {
    localStorage.setItem('ca.account', j.account || '');
  } catch {
    /* ignore */
  }
  return j.access_token;
}

/** The church's service account email (share sheets with this address). Server mode only. */
export function getServiceAccount() {
  try {
    return localStorage.getItem('ca.account') || '';
  } catch {
    return '';
  }
}

/** Server mode: sign in with name + church passcode. Stays signed in on this device. */
export async function passcodeSignIn(name: string, passcode: string): Promise<void> {
  const r = await fetch('/api/auth/login', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, passcode }),
  });
  if (r.status === 401) throw new Error("That passcode isn't right.");
  if (r.status === 400) throw new Error('Please enter your name.');
  if (!r.ok) throw new Error("Sign-in isn't set up on the server yet.");
  const t = await serverToken();
  if (!t) throw new Error('Sign-in did not stick. Make sure cookies are allowed for this site.');
}

/**
 * Call once at startup. Detects whether the server sign-in is available and, if the person
 * is already signed in there, loads a token. Returns whether they're signed in.
 */
export async function initAuth(): Promise<{ server: boolean; signedIn: boolean }> {
  try {
    const t = await serverToken();
    mode = 'server';
    if (!t) clearToken();
    return { server: true, signedIn: !!t };
  } catch {
    mode = 'browser';
    return { server: false, signedIn: hasValidToken() };
  }
}

export function hasValidToken() {
  return !!current && current.expires > Date.now();
}

export function setClientId(id: string) {
  clientIdForRefresh = id;
}

// ---------- browser (popup) mode ----------

function waitForGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      if (window.google?.accounts?.oauth2) return resolve();
      if (Date.now() - start > 10000) return reject(new Error('Could not load Google sign-in. Check your internet connection.'));
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function ensureClient(clientId: string) {
  await waitForGis();
  if (tokenClient) return;
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: (resp: any) => {
      const p = pending;
      pending = null;
      if (!p) return;
      if (resp.error) return p.reject(new Error(resp.error_description || resp.error));
      if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, SHEETS_SCOPE)) {
        return p.reject(
          new Error("Google didn't give this app permission to use your spreadsheets. Try again, and on Google's permission screen tick the box for “See, edit, create, and delete all your Google Sheets spreadsheets”."),
        );
      }
      store(resp.access_token, resp.expires_in);
      p.resolve(resp.access_token);
    },
    error_callback: (err: any) => {
      const p = pending;
      pending = null;
      p?.reject(new Error(err?.message || err?.type || 'Sign-in was cancelled.'));
    },
  });
}

async function popupSignIn(clientId: string, silent: boolean): Promise<string> {
  await ensureClient(clientId);
  const token = await new Promise<string>((resolve, reject) => {
    pending = { resolve, reject };
    const hint = getEmail();
    tokenClient.requestAccessToken({ prompt: silent ? '' : hint ? '' : 'select_account', login_hint: hint || undefined });
  });
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) setEmail((await r.json()).email);
  } catch {
    /* ignore */
  }
  return token;
}

// ---------- public API ----------

/** Browser mode: opens the Google sign-in popup (call from a tap). Server mode uses passcodeSignIn. */
export async function signIn(clientId: string): Promise<string> {
  if (mode === 'server') throw new Error('Use the passcode sign-in');
  return popupSignIn(clientId, false);
}

/** Returns a valid access token, refreshing it if needed. */
export async function getToken(): Promise<string> {
  if (current && current.expires > Date.now()) return current.token;
  if (mode === 'server') {
    let t: string | null;
    try {
      t = await serverToken();
    } catch (e) {
      throw new AuthError((e as Error).message);
    }
    if (!t) throw new AuthError('Please sign in again.');
    return t;
  }
  if (!clientIdForRefresh) throw new AuthError('Not signed in');
  try {
    return await popupSignIn(clientIdForRefresh, true);
  } catch (e) {
    throw new AuthError((e as Error).message);
  }
}

export function clearToken() {
  current = null;
  try {
    localStorage.removeItem(LS_TOKEN);
  } catch {
    /* ignore */
  }
}

export async function signOut() {
  if (mode === 'server') {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  } else if (current && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(current.token, () => {});
    } catch {
      /* ignore */
    }
  }
  clearToken();
  try {
    localStorage.removeItem(LS_EMAIL);
    localStorage.removeItem('ca.account');
  } catch {
    /* ignore */
  }
}
