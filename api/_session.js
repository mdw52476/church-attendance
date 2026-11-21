// Shared helpers for the sign-in endpoints (files starting with "_" are not routes on Vercel).
//
// How "stay signed in" works:
//   /api/auth/login     → sends the person to Google's sign-in page
//   /api/auth/callback  → Google sends them back with a one-time code; we trade it for a long-lived
//                         refresh token and keep it ENCRYPTED in an HttpOnly cookie on their device
//   /api/auth/token     → the app asks for a fresh 1-hour Google access token whenever it needs one
//   /api/auth/logout    → revokes the refresh token and clears the cookie
//
// Env vars (Vercel → Project → Settings → Environment Variables):
//   GOOGLE_CLIENT_ID      the OAuth Client ID (same as public/config.json)
//   GOOGLE_CLIENT_SECRET  the OAuth Client secret (never put this in the code)
//   SESSION_SECRET        optional; extra key material for cookie encryption

import crypto from 'node:crypto';

export const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
export const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
export const SCOPES = 'openid email profile https://www.googleapis.com/auth/spreadsheets';
export const SESSION_COOKIE = 'ca_session';
export const STATE_COOKIE = 'ca_state';
const YEAR = 400 * 24 * 3600; // browsers cap cookie lifetime at ~400 days

function key() {
  return crypto
    .createHash('sha256')
    .update('church-attendance-session:' + (process.env.SESSION_SECRET || '') + ':' + CLIENT_SECRET)
    .digest();
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

export function setCookie(res, name, value, maxAge = YEAR) {
  const c = `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
}

export function clearCookie(res, name) {
  setCookie(res, name, '', 0);
}

export function siteOrigin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}

export function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function redirect(res, to) {
  res.statusCode = 302;
  res.setHeader('Location', to);
  res.setHeader('Cache-Control', 'no-store');
  res.end();
}

export async function googleToken(params) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const body = await r.json().catch(() => ({}));
  return { ok: r.ok, body };
}

export function configured() {
  return !!(CLIENT_ID && CLIENT_SECRET);
}
