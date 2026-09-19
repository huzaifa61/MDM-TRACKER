import { createAdminCookie } from '@/lib/adminAuth';
import crypto from 'crypto';

function safeEqualStr(a, b) {
  const bufA = Buffer.from(String(a || ''));
  const bufB = Buffer.from(String(b || ''));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const { password } = req.body || {};
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected || !password || !safeEqualStr(password, expected)) {
    return res.status(401).json({ error: 'invalid_password' });
  }

  res.setHeader('Set-Cookie', createAdminCookie());
  return res.status(200).json({ ok: true });
}
