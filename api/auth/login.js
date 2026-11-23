import { SESSION_COOKIE, configured, json, passcodeMatches, passcodeVersion, readJsonBody, seal, setCookie } from '../_session.js';

// POST { name, passcode } → signs this device in (stays signed in until sign-out or the passcode changes)
export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!configured()) return json(res, 503, { error: 'not_configured' });
  const { name, passcode } = await readJsonBody(req);
  const who = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  if (!who) return json(res, 400, { error: 'name_required' });
  if (!passcodeMatches(passcode)) {
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    return json(res, 401, { error: 'wrong_passcode' });
  }
  setCookie(res, SESSION_COOKIE, seal({ name: who, pv: passcodeVersion(), t: Date.now() }));
  json(res, 200, { ok: true, name: who });
}
