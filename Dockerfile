# Checkend on Node, without Cloudflare: one container, one SQLite file on a volume.
#   docker build -t checkend .
#   docker run -p 8787:8787 -v checkend-data:/data -e ADMIN_TOKEN=<32+ characters> checkend
# See examples/docker/compose.yaml. Settings: the same environment variables as the Worker,
# plus the Node ones listed in src/entry/server.ts.
# Node 22.18 or later runs the TypeScript sources directly (type stripping); no build step.
FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Runtime dependencies only, without install scripts.
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9
ENV NODE_ENV=production \
    DATABASE_PATH=/data/checkend.sqlite \
    BLOBS_DIR=/data/blobs \
    PORT=8787 \
    HOST=0.0.0.0 \
    NODE_NO_WARNINGS=1
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY migrations ./migrations
COPY src ./src
COPY scripts/backup.ts ./scripts/backup.ts
# A non-root user (the "node" user of the base image) owns only the data volume.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
# Migrations run at start (forward-only). SIGTERM: the server stops taking requests, writes
# what it accepted, and exits.
CMD ["node", "src/entry/server.ts"]
