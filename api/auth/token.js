import { SESSION_COOKIE, clearCookie, configured, googleToken, json, readCookie, unseal } from '../_session.js';

// Returns a fresh 1-hour Google access token for the signed-in person.
export default async function handler(req, res) {
  if (!configured()) return json(res, 503, { error: 'not_configured' });
  const session = unseal(readCookie(req, SESSION_COOKIE));
  if (!session?.rt) return json(res, 401, { error: 'signed_out' });

  const { ok, body } = await googleToken({ grant_type: 'refresh_token', refresh_token: session.rt });
  if (!ok) {
    if (body.error === 'invalid_grant') clearCookie(res, SESSION_COOKIE); // revoked or expired: sign in again
    return json(res, 401, { error: body.error || 'refresh_failed' });
  }
  json(res, 200, { access_token: body.access_token, expires_in: body.expires_in, email: session.email || '' });
}
