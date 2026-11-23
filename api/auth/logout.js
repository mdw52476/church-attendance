import { SESSION_COOKIE, json, setCookie } from '../_session.js';

export default function handler(req, res) {
  setCookie(res, SESSION_COOKIE, '', 0);
  json(res, 200, { ok: true });
}
