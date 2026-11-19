// Google sign-in in the browser using Google Identity Services (no server needed).
// The access token is short-lived (~1 hour); we re-request it silently when it expires.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
  }
}

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets openid email profile';
const LS_TOKEN = 'ca.token';
const LS_EMAIL = 'ca.email';

interface StoredToken {
  token: string;
  expires: number;
}

let tokenClient: any = null;
let pending: { resolve: (t: string) => void; reject: (e: Error) => void } | null = null;
let current: StoredToken | null = null;

try {
  current = JSON.parse(localStorage.getItem(LS_TOKEN) || 'null');
} catch {
  current = null;
}

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
      // Google lets people untick individual permissions; the app can't work without Sheets access.
      if (!window.google.accounts.oauth2.hasGrantedAllScopes(resp, 'https://www.googleapis.com/auth/spreadsheets')) {
        return p.reject(
          new Error("Google didn't give this app permission to use your spreadsheets. Try again, and on Google's permission screen tick the box for “See, edit, create, and delete all your Google Sheets spreadsheets”."),
        );
      }
      current = { token: resp.access_token, expires: Date.now() + (Number(resp.expires_in) - 60) * 1000 };
      localStorage.setItem(LS_TOKEN, JSON.stringify(current));
      p.resolve(resp.access_token);
    },
    error_callback: (err: any) => {
      const p = pending;
      pending = null;
      p?.reject(new Error(err?.message || err?.type || 'Sign-in was cancelled.'));
    },
  });
}

export function hasValidToken() {
  return !!current && current.expires > Date.now();
}

export function getEmail() {
  return localStorage.getItem(LS_EMAIL) || '';
}

/** Opens the Google popup (must be called from a tap/click). */
export async function signIn(clientId: string, silent = false): Promise<string> {
  await ensureClient(clientId);
  const token = await new Promise<string>((resolve, reject) => {
    pending = { resolve, reject };
    const hint = getEmail();
    tokenClient.requestAccessToken({ prompt: silent ? '' : hint ? '' : 'select_account', login_hint: hint || undefined });
  });
  try {
    const r = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${token}` } });
    if (r.ok) {
      const info = await r.json();
      if (info.email) localStorage.setItem(LS_EMAIL, info.email);
    }
  } catch {
    /* ignore */
  }
  return token;
}

let clientIdForRefresh = '';
export function setClientId(id: string) {
  clientIdForRefresh = id;
}

/** Returns a valid token, refreshing silently if needed. */
export async function getToken(): Promise<string> {
  if (current && current.expires > Date.now()) return current.token;
  if (!clientIdForRefresh) throw new AuthError('Not signed in');
  try {
    return await signIn(clientIdForRefresh, true);
  } catch (e) {
    throw new AuthError((e as Error).message);
  }
}

export function clearToken() {
  current = null;
  localStorage.removeItem(LS_TOKEN);
}

export function signOut() {
  if (current && window.google?.accounts?.oauth2) {
    try {
      window.google.accounts.oauth2.revoke(current.token, () => {});
    } catch {
      /* ignore */
    }
  }
  clearToken();
  localStorage.removeItem(LS_EMAIL);
}

export class AuthError extends Error {}
