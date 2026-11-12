FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm exec next build

FROM postgres:17-bookworm AS runtime
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/app/data
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /usr/local/bin/node /usr/local/bin/node
RUN groupadd --gid 1001 knowledge && useradd --uid 1001 --gid knowledge --system knowledge \
    && mkdir -p /app/data && chown knowledge:knowledge /app /app/data
COPY --from=build --chown=knowledge:knowledge /app/.next/standalone ./
COPY --from=build --chown=knowledge:knowledge /app/.next/static ./.next/static
COPY --from=build --chown=knowledge:knowledge /app/public ./public
COPY --from=build --chown=knowledge:knowledge /app/deploy/migrations ./deploy/migrations
COPY --from=build --chown=knowledge:knowledge /app/deploy/admin-account.cjs /app/deploy/password.cjs ./deploy/
COPY --from=build --chown=knowledge:knowledge /app/VERSION ./VERSION
USER knowledge
EXPOSE 3000
ENTRYPOINT []
CMD ["node", "server.js"]
