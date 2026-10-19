export interface Provisioned { id: string; ip: string }
export interface Provider {
  name: string;
  create(opts: { name: string; userData: string; labels?: Record<string, string> }): Promise<Provisioned>;
  destroy(id: string): Promise<void>;
  /** Servers this platform created (label keel=1). Used by the orphan sweeper. */
  list(): Promise<{ id: string; name: string; created: number }[]>;
}

/** In-memory provider for tests and local development. */
export function mockProvider(): Provider & { servers: Map<string, { name: string; userData: string; labels: Record<string, string>; created: number }> } {
  const servers = new Map<string, { name: string; userData: string; labels: Record<string, string>; created: number }>();
  let n = 0;
  return {
    name: 'mock', servers,
    async create(o) { const id = 'mock-' + ++n; servers.set(id, { name: o.name, userData: o.userData, labels: o.labels ?? {}, created: Math.floor(Date.now() / 1000) }); return { id, ip: `10.0.0.${n}` }; },
    async destroy(id) { servers.delete(id); },
    async list() { return [...servers.entries()].filter(([, s]) => s.labels.keel === '1').map(([id, s]) => ({ id, name: s.name, created: s.created })); },
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
        labels: { keel: '1', ...(o.labels ?? {}) },
      }) });
      if (!res.ok) throw new Error(`hetzner create failed: ${res.status} ${await res.text()}`);
      const j: any = await res.json();
      return { id: String(j.server.id), ip: j.server.public_net.ipv4.ip };
    },
    async destroy(id) {
      const res = await f(`${base}/servers/${id}`, { method: 'DELETE', headers: H });
      if (!res.ok && res.status !== 404) throw new Error(`hetzner delete failed: ${res.status}`);
    },
    async list() {
      const out: { id: string; name: string; created: number }[] = [];
      for (let page = 1; page < 50; page++) {
        const res = await f(`${base}/servers?label_selector=keel%3D1&per_page=50&page=${page}`, { headers: H });
        if (!res.ok) throw new Error(`hetzner list failed: ${res.status}`);
        const j: any = await res.json();
        for (const s of j.servers ?? []) out.push({ id: String(s.id), name: s.name, created: Math.floor(Date.parse(s.created) / 1000) });
        if (!j.meta?.pagination?.next_page) break;
      }
      return out;
    },
  };
}
