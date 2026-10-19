import { open } from './db.ts';
import { service } from './service.ts';
import { api } from './api.ts';
import { hetznerProvider, mockProvider } from './providers.ts';

const env = process.env;
const kind = env.KEEL_PROVIDER ?? 'mock';
const provider = kind === 'hetzner' ? hetznerProvider({ token: env.HCLOUD_TOKEN ?? '', type: env.HCLOUD_TYPE, location: env.HCLOUD_LOCATION }) : mockProvider();
if (kind === 'hetzner' && !env.HCLOUD_TOKEN) throw new Error('HCLOUD_TOKEN required');
const db = open(env.KEEL_PLATFORM_DB ?? './platform.db');
const svc = service(db, provider, {
  repo: env.KEEL_REPO ?? 'https://github.com/OWNER/keel.git', ref: env.KEEL_REF ?? 'main',
  baseUrl: env.KEEL_PLATFORM_URL ?? 'http://localhost:8787', domain: env.KEEL_DOMAIN ?? 'streams.example.com',
  idleMinutes: Number(env.KEEL_IDLE_MINUTES ?? 15), maxServersPerHour: Number(env.KEEL_MAX_SERVERS_PER_HOUR ?? 20),
});
const port = Number(env.PORT ?? 8787);
api(svc, { adminToken: env.KEEL_ADMIN_TOKEN ?? '', stripeSecret: env.STRIPE_WEBHOOK_SECRET }).listen(port, () => console.log(`keel platform on :${port} provider=${provider.name}`));
