import { createHmac, timingSafeEqual } from 'node:crypto';
/** Verifies a Stripe webhook signature (v1 scheme) without the SDK. tolerance in seconds. */
export function verifyStripe(payload: string, header: string, secret: string, tolerance = 300, nowSec = Math.floor(Date.now() / 1000)): boolean {
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
  const t = Number(parts.t); const sig = parts.v1; if (!t || !sig) return false;
  if (Math.abs(nowSec - t) > tolerance) return false;
  const exp = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const a = Buffer.from(exp), b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}
