// Shared helpers for the sign-in endpoints (files starting with "_" are not routes on Vercel).
//
// How sign-in works:
//   • The app reaches the Google Sheet as its own Google "service account" (a robot account the sheet
//     is shared with). Volunteers never sign in to Google.
//   • Volunteers sign in with their name + the church passcode (POST /api/auth/login). They get an
//     encrypted HttpOnly cookie and stay signed in on that device until they sign out.
//   • /api/auth/token hands a signed-in device a short-lived (1 hour) Google access token for the
//     service account, so the app can read/write the sheet directly.
//   • Changing APP_PASSCODE signs everyone out (their cookie no longer matches).
//
// Env vars (Vercel → Project → Settings → Environment Variables):
//   GOOGLE_SERVICE_ACCOUNT_JSON  the service account's JSON key file contents (Sensitive)
//   APP_PASSCODE                 the church passcode volunteers type to sign in (Sensitive)
//   SESSION_SECRET               optional extra key material for cookie encryption

import crypto from 'node:crypto';

export const SESSION_COOKIE = 'ca_session';
const COOKIE_AGE = 400 * 24 * 3600; // browsers cap cookies at ~400 days
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export function serviceAccount() {
  const raw = (process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    const text = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    const sa = JSON.parse(text);
    return sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

const passcode = () => (process.env.APP_PASSCODE || '').trim();

export function configured() {
  return !!(serviceAccount() && passcode());
}

function key() {
  const sa = serviceAccount();
  return crypto
    .createHash('sha256')
    .update('church-attendance-session:' + (process.env.SESSION_SECRET || '') + ':' + (sa?.private_key || ''))
    .digest();
}

/** Short fingerprint of the current passcode; stored in the cookie so changing the passcode signs everyone out. */
export function passcodeVersion() {
  return crypto.createHash('sha256').update('pv:' + passcode()).digest('hex').slice(0, 16);
}

export function passcodeMatches(attempt) {
  const a = crypto.createHash('sha256').update(String(attempt || '').trim()).digest();
  const b = crypto.createHash('sha256').update(passcode()).digest();
  return crypto.timingSafeEqual(a, b) && passcode() !== '';
}

export function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64url');
}

export function unseal(s) {
  try {
    const b = Buffer.from(s, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch {
    return null;
  }
}

export function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

export function setCookie(res, name, value, maxAge = COOKIE_AGE) {
  res.setHeader('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`);
}

/** The signed-in volunteer, or null. */
export function currentSession(req) {
  const s = unseal(readCookie(req, SESSION_COOKIE));
  if (!s || !s.name || s.pv !== passcodeVersion()) return null;
  return s;
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

// ---- service-account access token (cached per server instance) ----
let cached = null; // { token, exp }

export async function serviceToken() {
  if (cached && cached.exp - 120 > Date.now() / 1000) return cached;
  const sa = serviceAccount();
  const now = Math.floor(Date.now() / 1000);
  const enc = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc({ iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key).toString('base64url');
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error_description || body.error || 'service account token failed');
  cached = { token: body.access_token, exp: now + Number(body.expires_in || 3600) };
  return cached;
}
