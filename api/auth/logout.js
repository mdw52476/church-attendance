import { SESSION_COOKIE, clearCookie, json, readCookie, unseal } from '../_session.js';

export default async function handler(req, res) {
  const session = unseal(readCookie(req, SESSION_COOKIE));
  if (session?.rt) {
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(session.rt)}`, { method: 'POST' }).catch(() => {});
  }
  clearCookie(res, SESSION_COOKIE);
  json(res, 200, { ok: true });
}
