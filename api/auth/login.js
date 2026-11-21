import crypto from 'node:crypto';
import { CLIENT_ID, SCOPES, STATE_COOKIE, configured, redirect, seal, setCookie, siteOrigin } from '../_session.js';

export default function handler(req, res) {
  if (!configured()) return redirect(res, '/?auth_error=not_configured');
  const url = new URL(req.url, 'http://x');
  const hint = url.searchParams.get('hint') || '';
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, STATE_COOKIE, seal({ state, t: Date.now() }), 600);
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: `${siteOrigin(req)}/api/auth/callback`,
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline', // gives a refresh token so the person stays signed in
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  if (hint) q.set('login_hint', hint);
  redirect(res, `https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}
