export interface Provisioned { id: string; ip: string }
export interface Provider {
  name: string;
  create(opts: { name: string; userData: string }): Promise<Provisioned>;
  destroy(id: string): Promise<void>;
}

/** In-memory provider for tests and local development. */
export function mockProvider(): Provider & { servers: Map<string, { name: string; userData: string }> } {
  const servers = new Map<string, { name: string; userData: string }>();
  let n = 0;
  return {
    name: 'mock', servers,
    async create(o) { const id = 'mock-' + ++n; servers.set(id, { name: o.name, userData: o.userData }); return { id, ip: `10.0.0.${n}` }; },
    async destroy(id) { servers.delete(id); },
  };
}

/** Hetzner Cloud. Needs HCLOUD_TOKEN. Untested against the live API. Docs: https://docs.hetzner.cloud */
export function hetznerProvider(cfg: { token: string; type?: string; image?: string; location?: string; fetchImpl?: typeof fetch }): Provider {
  const f = cfg.fetchImpl ?? fetch;
  const H = { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' };
  const base = 'https://api.hetzner.cloud/v1';
  return {
    name: 'hetzner',
    async create(o) {
      const res = await f(base + '/servers', { method: 'POST', headers: H, body: JSON.stringify({
        name: o.name, server_type: cfg.type ?? 'cpx31', image: cfg.image ?? 'ubuntu-24.04', location: cfg.location ?? 'fsn1',
        user_data: o.userData, start_after_create: true, public_net: { enable_ipv4: true, enable_ipv6: false },
      }) });
      if (!res.ok) throw new Error(`hetzner create failed: ${res.status} ${await res.text()}`);
      const j: any = await res.json();
      return { id: String(j.server.id), ip: j.server.public_net.ipv4.ip };
    },
    async destroy(id) {
      const res = await f(`${base}/servers/${id}`, { method: 'DELETE', headers: H });
      if (!res.ok && res.status !== 404) throw new Error(`hetzner delete failed: ${res.status}`);
    },
  };
}
