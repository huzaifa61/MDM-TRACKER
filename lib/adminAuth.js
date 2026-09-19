import crypto from 'crypto';

const COOKIE_NAME = 'mdm_admin';
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 hours

function sign(value) {
  const secret = process.env.APP_TOKEN_SECRET;
  if (!secret) throw new Error('APP_TOKEN_SECRET is not set');
  const sig = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  return `${value}.${sig}`;
}

function verify(signed) {
  if (!signed || !signed.includes('.')) return false;
  const [value, sig] = signed.split('.');
  const secret = process.env.APP_TOKEN_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(value).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  return value === 'ok' && a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Hand-rolled instead of pulling in a cookie library: the need is one HttpOnly cookie with a
// handful of fixed attributes, which is simpler to own outright than to chase a third-party
// package's exact export shape/version (this project's `cookie` dependency turned out to ship
// a totally different API - parseCookie/stringifyCookie - than the classic parse/serialize one).
function serializeAdminCookie(value) {
  const attrs = [`${COOKIE_NAME}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${MAX_AGE_SECONDS}`];
  if (process.env.NODE_ENV === 'production') attrs.push('Secure');
  return attrs.join('; ');
}

function parseCookieHeader(header) {
  const out = {};
  (header || '').split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  });
  return out;
}

export function createAdminCookie() {
  return serializeAdminCookie(sign('ok'));
}

export function isAdminRequest(req) {
  const cookies = parseCookieHeader(req.headers.cookie);
  return verify(cookies[COOKIE_NAME]);
}
