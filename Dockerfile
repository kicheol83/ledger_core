FROM node:20-alpine AS base
ENV HUSKY=0 COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY db/package.json db/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm --filter @ledgercore/api build && pnpm --filter @ledgercore/web build
RUN pnpm --filter @ledgercore/api deploy --prod /out/api && cp -r apps/api/dist /out/api/dist

FROM deps AS migrate
RUN apk add --no-cache postgresql-client
COPY db ./db
CMD ["sh", "-c", "pnpm exec node-pg-migrate -m db/migrations -j sql up && psql \"$DATABASE_URL\" -v ON_ERROR_STOP=1 -f db/seeds/01-system-accounts.sql"]

FROM node:20-alpine AS api
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build --chown=node:node /out/api/package.json ./package.json
COPY --from=build --chown=node:node /out/api/node_modules ./node_modules
COPY --from=build --chown=node:node /out/api/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM caddy:2-alpine AS web
COPY docker/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
