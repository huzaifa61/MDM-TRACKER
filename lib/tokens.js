import crypto from 'crypto';

export function normalizeEmail(email) {
  return (email || '').toString().trim().toLowerCase();
}

// Token = base64url(HMAC_SHA256(APP_TOKEN_SECRET, normalizedEmail)) - nothing embedded or
// reversible. Verification re-hashes every current AGENTS email and compares, which is why a
// newly added AGENTS row gets a working link with zero extra setup, and why removing an agent
// silently revokes their link on the very next request.
export function generateToken(email) {
  const secret = process.env.APP_TOKEN_SECRET;
  if (!secret) throw new Error('APP_TOKEN_SECRET is not set');
  return crypto.createHmac('sha256', secret).update(normalizeEmail(email)).digest('base64url');
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a || '');
  const bufB = Buffer.from(b || '');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function resolveAgentFromToken(token, agents) {
  if (!token || typeof token !== 'string') return null;
  for (const agent of agents) {
    if (safeEqual(generateToken(agent.email), token)) return agent;
  }
  return null;
}
