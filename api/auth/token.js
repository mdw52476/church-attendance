import { configured, currentSession, json, serviceAccount, serviceToken } from '../_session.js';

// Returns a 1-hour Google access token for the app's service account, to signed-in devices only.
export default async function handler(req, res) {
  if (!configured()) return json(res, 503, { error: 'not_configured' });
  const session = currentSession(req);
  if (!session) return json(res, 401, { error: 'signed_out' });
  try {
    const t = await serviceToken();
    json(res, 200, {
      access_token: t.token,
      expires_in: Math.max(60, t.exp - Math.floor(Date.now() / 1000)),
      name: session.name,
      account: serviceAccount().client_email,
    });
  } catch (e) {
    json(res, 502, { error: 'google_error', message: String(e.message || e) });
  }
}
