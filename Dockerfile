# Fahim application image (ARCHITECTURE.md: one container, starts with `docker run` on any host).
# Stages: deps -> build (Next.js standalone) -> app (runtime); "tools" runs migrations and operator scripts.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Migrations (db/migrate.ts) and operator scripts (scripts/invite.ts, scripts/compose-init.ts).
FROM deps AS tools
COPY . .
CMD ["npx", "tsx", "scripts/compose-init.ts"]

FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S fahim && adduser -S fahim -G fahim
COPY --from=build --chown=fahim:fahim /app/.next/standalone ./
COPY --from=build --chown=fahim:fahim /app/.next/static ./.next/static
COPY --from=build --chown=fahim:fahim /app/prompts ./prompts
USER fahim
EXPOSE 3000
CMD ["node", "server.js"]
