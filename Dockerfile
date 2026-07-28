# Debian-based rather than Alpine on purpose: better-sqlite3 is a native
# module, and the glibc prebuilds mean no compiler is needed in the image.

# ---------------------------------------------------------------- build stage
FROM node:22-slim AS build
WORKDIR /app

# Copy manifests first so dependency install is cached independently of source.
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build

# --------------------------------------------------------- production modules
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev && npm cache clean --force

# -------------------------------------------------------------- runtime stage
FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    DATABASE_PATH=/data/home-budget.sqlite

# `config.ts` resolves the repo root two levels up from the compiled server
# directory, so this layout has to match the source tree: /app/server/dist and
# /app/web/dist.
COPY --from=deps  /app/node_modules      ./node_modules
COPY --from=build /app/server/dist       ./server/dist
COPY --from=build /app/web/dist          ./web/dist
COPY package.json ./
COPY server/package.json ./server/

# The Fly volume mounts here. Created so the image also runs without one.
RUN mkdir -p /data

EXPOSE 8080

# Fly runs its own health checks against /api/health; this covers plain Docker.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/dist/index.js"]
