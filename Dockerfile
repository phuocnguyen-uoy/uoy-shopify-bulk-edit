FROM node:22-alpine AS base
RUN apk add --no-cache openssl
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

# The React Router build needs devDependencies (vite, @react-router/dev), so this
# stage installs everything. NODE_ENV stays unset here on purpose.
FROM base AS build
# Limit Node heap to leave headroom for OS + pnpm on memory-constrained build environments.
ENV NODE_OPTIONS="--max-old-space-size=400"
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY extensions ./extensions
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm run build

# Separate production-only install so the runtime image ships without build tooling.
FROM base AS deps
ENV NODE_ENV=production
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY extensions ./extensions
RUN pnpm install --frozen-lockfile --prod

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY public ./public

EXPOSE 3000

CMD ["pnpm", "run", "docker-start"]
