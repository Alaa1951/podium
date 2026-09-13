FROM node:24-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

# ── Dependencies ────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# ── Build ───────────────────────────────────────────────────────────────────
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `npm run build` runs `prisma generate` first, which needs both the schema and
# prisma7.config.ts — hence the full copy above. The generated client lands in
# src/generated/prisma and is traced into the standalone bundle.
RUN npm run build

# ── Runtime ─────────────────────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Never run the server as root.
RUN addgroup --system --gid 1001 podium \
  && adduser --system --uid 1001 --ingroup podium podium

# The app itself: a self-contained server bundle with its own minimal
# node_modules, plus the assets Next serves alongside it.
COPY --from=builder --chown=podium:podium /app/.next/standalone ./
COPY --from=builder --chown=podium:podium /app/.next/static ./.next/static
COPY --from=builder --chown=podium:podium /app/public ./public
COPY --chown=podium:podium server.js ./server.js

# The Prisma CLI, kept for `migrate deploy` and `db seed` on start. It is not
# used to serve requests — the standalone bundle carries its own client — so it
# lives beside the app rather than inside it.
COPY --from=deps --chown=podium:podium /app/node_modules ./node_modules
COPY --from=builder --chown=podium:podium /app/src/generated ./src/generated
COPY --from=builder --chown=podium:podium /app/prisma ./prisma
COPY --from=builder --chown=podium:podium /app/prisma7.config.ts ./prisma7.config.ts
COPY --chown=podium:podium package.json package-lock.json ./

# A build carries the developer's .env into the standalone bundle; the real
# values come from the environment at run time, and this must not shadow them.
RUN rm -f .env .env.local .env.production .env.production.local

USER podium
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Migrations are applied on start so a fresh database comes up ready. Seeding is
# the demo field and is deliberately best-effort: it is a no-op once the live
# event already has teams, and a failure must not stop the server.
CMD ["sh", "-c", "npx prisma migrate deploy && (npx prisma db seed || echo '[start] seed skipped') && node server.js"]
