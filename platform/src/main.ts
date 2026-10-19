import { open } from './db.ts';
import { service } from './service.ts';
import { api } from './api.ts';
import { hetznerProvider, mockProvider } from './providers.ts';
import { cloudflareDns, sslipDns } from './dns.ts';

const env = process.env;
const kind = env.KEEL_PROVIDER ?? 'mock';
if (kind === 'hetzner' && !env.HCLOUD_TOKEN) throw new Error('HCLOUD_TOKEN required');
const provider = kind === 'hetzner' ? hetznerProvider({ token: env.HCLOUD_TOKEN ?? '', type: env.HCLOUD_TYPE, location: env.HCLOUD_LOCATION }) : mockProvider();
const dnsKind = env.KEEL_DNS ?? 'sslip';
if (dnsKind === 'cloudflare' && (!env.CF_API_TOKEN || !env.CF_ZONE_ID || !env.KEEL_DOMAIN)) throw new Error('KEEL_DNS=cloudflare needs CF_API_TOKEN, CF_ZONE_ID and KEEL_DOMAIN');
const dns = dnsKind === 'cloudflare' ? cloudflareDns({ token: env.CF_API_TOKEN!, zoneId: env.CF_ZONE_ID!, domain: env.KEEL_DOMAIN! }) : sslipDns();
const db = open(env.KEEL_PLATFORM_DB ?? './platform.db');
const svc = service(db, provider, {
  repo: env.KEEL_REPO ?? 'https://github.com/OWNER/keel.git', ref: env.KEEL_REF ?? 'main',
  baseUrl: env.KEEL_PLATFORM_URL ?? 'http://localhost:8787',
  idleMinutes: Number(env.KEEL_IDLE_MINUTES ?? 15), maxServersPerHour: Number(env.KEEL_MAX_SERVERS_PER_HOUR ?? 20),
  bootTimeoutMin: Number(env.KEEL_BOOT_TIMEOUT_MIN ?? 15), imagePrefix: env.KEEL_IMAGE_PREFIX, imageTag: env.KEEL_IMAGE_TAG,
}, { dns });
const port = Number(env.PORT ?? 8787);
api(svc, { adminToken: env.KEEL_ADMIN_TOKEN ?? '', stripeSecret: env.STRIPE_WEBHOOK_SECRET }).listen(port, () => console.log(`keel platform on :${port} provider=${provider.name} dns=${dns.name}`));

// Readiness: booting servers become running once their HTTPS dashboard answers.
setInterval(() => void svc.tick().catch((e: Error) => console.error('tick failed:', e.message)), 15_000).unref();
// Orphan sweeper: destroys provider servers labelled keel=1 that no tenant owns (crashes mid-create, manual mistakes).
const sweep = () => void svc.sweep().then((r) => r.length && console.log(`sweeper removed ${r.length} orphan server(s): ${r.join(', ')}`)).catch((e: Error) => console.error('sweep failed:', e.message));
setInterval(sweep, 3_600_000).unref();
setTimeout(sweep, 60_000).unref();
