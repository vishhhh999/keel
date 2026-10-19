/** Builds the cloud-init script that turns a blank Ubuntu server into a Keel stack. Values are quoted for the shell. */
const q = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

export interface CloudInitOptions {
  repo: string;
  ref: string;
  apiToken: string;
  obsPassword: string;
  ingestPath: string;
  /** Hostname for HTTPS, or null to derive "<ip>.sslip.io" on the server at boot. */
  publicHost: string | null;
  /** KEEL_DESTINATIONS value: "Name=url;Name=url". */
  destinations: string;
  idleWebhook: string;
  idleMinutes: number;
  /** ghcr.io/<owner>/keel to pull prebuilt images (boots in about a minute instead of building). */
  imagePrefix?: string;
  imageTag?: string;
}

export function cloudInit(o: CloudInitOptions): string {
  const env = [
    `KEEL_API_TOKEN=${o.apiToken}`,
    `KEEL_OBS_PASSWORD=${o.obsPassword}`,
    `KEEL_INGEST_PATH=${o.ingestPath}`,
    `KEEL_PUBLIC_HOST=${o.publicHost ?? '__KEEL_AUTO_HOST__'}`,
    'KEEL_DASHBOARD_BIND=127.0.0.1',
    'KEEL_OUTPUT_MODE=relay',
    `KEEL_DESTINATIONS=${o.destinations}`,
    `KEEL_IDLE_MINUTES=${o.idleMinutes}`,
    'KEEL_IDLE_ACTION=webhook',
    `KEEL_IDLE_WEBHOOK=${o.idleWebhook}`,
    ...(o.imagePrefix ? [`KEEL_IMAGE_PREFIX=${o.imagePrefix}`, `KEEL_IMAGE_TAG=${o.imageTag ?? 'latest'}`] : []),
  ];
  const autoHost = o.publicHost === null
    ? `  - |
    IP=$(curl -fsS --max-time 5 http://169.254.169.254/hetzner/v1/metadata/public-ipv4 || curl -fsS --max-time 5 https://api.ipify.org)
    sed -i "s/__KEEL_AUTO_HOST__/$(echo "$IP" | tr . -).sslip.io/" /opt/keel/stack/.env
`
    : '';
  return `#cloud-config
package_update: true
packages: [git, curl, ca-certificates, ufw]
runcmd:
  - curl -fsSL https://get.docker.com | sh
  - git clone --depth 1 --branch ${q(o.ref)} ${q(o.repo)} /opt/keel
  - |
    cat > /opt/keel/stack/.env <<'ENVEOF'
${env.map((l) => '    ' + l).join('\n')}
    ENVEOF
${autoHost}  - chmod 600 /opt/keel/stack/.env
  - ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 8890/udp && ufw allow 1935/tcp && ufw --force enable
  - cd /opt/keel/stack && docker compose --profile tls pull --ignore-pull-failures --quiet; docker compose --profile tls up -d --build
`;
}
