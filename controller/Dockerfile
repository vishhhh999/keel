FROM node:22-slim

WORKDIR /app
COPY package.json package-lock.json ./
# Optional: behind a TLS-intercepting proxy, pass a CA bundle at build time:
#   docker build --secret id=ca,src=/path/ca.crt .
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --omit=dev
COPY src ./src
COPY public ./public

ENV NODE_ENV=production \
    KEEL_PUBLIC_DIR=/app/public \
    KEEL_DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/main.ts"]
