import { SESSION_COOKIE, STATE_COOKIE, clearCookie, googleToken, readCookie, redirect, seal, setCookie, siteOrigin, unseal } from '../_session.js';

export default async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const fail = (code) => {
    clearCookie(res, STATE_COOKIE);
    redirect(res, `/?auth_error=${encodeURIComponent(code)}`);
  };
  if (url.searchParams.get('error')) return fail(url.searchParams.get('error'));

  const saved = unseal(readCookie(req, STATE_COOKIE));
  if (!saved || saved.state !== url.searchParams.get('state') || Date.now() - saved.t > 600000) return fail('expired');

  const { ok, body } = await googleToken({
    grant_type: 'authorization_code',
    code: url.searchParams.get('code') || '',
    redirect_uri: `${siteOrigin(req)}/api/auth/callback`,
  });
  if (!ok) return fail(body.error || 'token_exchange_failed');
  if (!String(body.scope || '').includes('/auth/spreadsheets')) return fail('no_sheets_permission');
  if (!body.refresh_token) return fail('no_refresh_token');

  let email = '';
  try {
    email = JSON.parse(Buffer.from(String(body.id_token).split('.')[1], 'base64url').toString('utf8')).email || '';
  } catch {
    /* email is only used for "who made this change" */
  }
  clearCookie(res, STATE_COOKIE);
  setCookie(res, SESSION_COOKIE, seal({ rt: body.refresh_token, email }));
  redirect(res, '/');
}
