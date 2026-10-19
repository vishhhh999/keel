import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';

export type ServerState = 'none' | 'provisioning' | 'booting' | 'running' | 'stopping' | 'stopped' | 'error';
export interface Tenant { id: string; name: string; email: string; plan: string; stripe_customer: string | null; status: string; created: number }
export interface ServerRow { tenant_id: string; provider_id: string | null; ip: string | null; state: ServerState; started: number | null; updated: number; error: string | null; api_token: string | null; host: string | null; ingest_path: string | null }

export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const token = (prefix: string) => prefix + '_' + randomBytes(24).toString('base64url');

export function open(path: string) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, plan TEXT NOT NULL DEFAULT 'trial',
      stripe_customer TEXT, status TEXT NOT NULL DEFAULT 'active', token_hash TEXT NOT NULL, hook_secret TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS servers (tenant_id TEXT PRIMARY KEY REFERENCES tenants(id), provider_id TEXT, ip TEXT, state TEXT NOT NULL DEFAULT 'none',
      started INTEGER, updated INTEGER NOT NULL, error TEXT, api_token TEXT);
    CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, started INTEGER NOT NULL, ended INTEGER NOT NULL, seconds INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS usage_tenant ON usage(tenant_id, ended);
    CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, t INTEGER NOT NULL, tenant_id TEXT, event TEXT NOT NULL, detail TEXT);
  `);
  // Additive migrations for databases created by earlier versions.
  const cols = (db.prepare('PRAGMA table_info(servers)').all() as { name: string }[]).map((c) => c.name);
  for (const [c, type] of [['host', 'TEXT'], ['ingest_path', 'TEXT']] as const) if (!cols.includes(c)) db.exec(`ALTER TABLE servers ADD COLUMN ${c} ${type}`);
  return db;
}
export type DB = ReturnType<typeof open>;
