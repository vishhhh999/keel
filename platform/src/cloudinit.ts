/** Builds the cloud-init script that turns a blank Ubuntu server into a Keel stack. Values are quoted for the shell. */
const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

export function cloudInit(o: { repo: string; ref: string; apiToken: string; obsPassword: string; ingestPath: string; publicHost: string;
  rtmpUrl: string; streamKey: string; idleWebhook: string; idleMinutes: number }): string {
  return `#cloud-config
package_update: true
packages: [git, curl, ca-certificates, ufw]
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - git clone --depth 1 --branch ${q(o.ref)} ${q(o.repo)} /opt/keel
  - |
    cat > /opt/keel/stack/.env <<'ENVEOF'
    KEEL_API_TOKEN=${o.apiToken}
    KEEL_OBS_PASSWORD=${o.obsPassword}
    KEEL_INGEST_PATH=${o.ingestPath}
    KEEL_PUBLIC_HOST=${o.publicHost}
    KEEL_DASHBOARD_BIND=127.0.0.1
    KEEL_RTMP_URL=${o.rtmpUrl}
    KEEL_STREAM_KEY=${o.streamKey}
    KEEL_IDLE_MINUTES=${o.idleMinutes}
    KEEL_IDLE_ACTION=webhook
    KEEL_IDLE_WEBHOOK=${o.idleWebhook}
    ENVEOF
  - chmod 600 /opt/keel/stack/.env
  - ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 8890/udp && ufw allow 1935/tcp && ufw --force enable
  - cd /opt/keel/stack && docker compose --profile tls up -d --build
`;
}
