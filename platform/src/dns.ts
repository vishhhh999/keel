// Hostnames for customer servers. Caddy needs a DNS name that points at the server
// before it can get an HTTPS certificate.
//
// sslip (default, zero setup): the hostname encodes the IP, e.g. 203-0-113-7.sslip.io.
//   The server works out its own name at boot from the cloud metadata service.
// cloudflare: <tenant>.<your domain>, an A record created through the Cloudflare API
//   when the server gets its IP and deleted when it stops. Branded, and survives provider changes.

export interface Dns {
  name: string;
  /** Hostname known before boot (cloudflare), or null when the server derives it at boot (sslip). */
  plannedHost(tenantId: string): string | null;
  /** Hostname once the IP is known. */
  hostFor(tenantId: string, ip: string): string;
  upsert(host: string, ip: string): Promise<void>;
  remove(host: string): Promise<void>;
}

export const sslipHost = (ip: string) => `${ip.replace(/[.:]/g, '-')}.sslip.io`;

export function sslipDns(): Dns {
  return {
    name: 'sslip',
    plannedHost: () => null,
    hostFor: (_t, ip) => sslipHost(ip),
    async upsert() {},
    async remove() {},
  };
}

export function cloudflareDns(cfg: { token: string; zoneId: string; domain: string; fetchImpl?: typeof fetch }): Dns {
  const f = cfg.fetchImpl ?? fetch;
  const base = `https://api.cloudflare.com/client/v4/zones/${cfg.zoneId}/dns_records`;
  const H = { authorization: `Bearer ${cfg.token}`, 'content-type': 'application/json' };
  const host = (t: string) => `${t.slice(0, 8)}.${cfg.domain}`;
  const find = async (name: string): Promise<string | null> => {
    const r = await f(`${base}?type=A&name=${encodeURIComponent(name)}`, { headers: H });
    if (!r.ok) throw new Error(`cloudflare lookup failed: ${r.status}`);
    const j: any = await r.json();
    return j.result?.[0]?.id ?? null;
  };
  return {
    name: 'cloudflare',
    plannedHost: host,
    hostFor: (t) => host(t),
    async upsert(name, ip) {
      const id = await find(name);
      const body = JSON.stringify({ type: 'A', name, content: ip, ttl: 60, proxied: false });
      const r = await f(id ? `${base}/${id}` : base, { method: id ? 'PUT' : 'POST', headers: H, body });
      if (!r.ok) throw new Error(`cloudflare upsert failed: ${r.status} ${await r.text()}`);
    },
    async remove(name) {
      const id = await find(name);
      if (!id) return;
      const r = await f(`${base}/${id}`, { method: 'DELETE', headers: H });
      if (!r.ok && r.status !== 404) throw new Error(`cloudflare delete failed: ${r.status}`);
    },
  };
}
