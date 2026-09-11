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
ENV NODE_OPTIONS="--max-old-space-size=384"
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY extensions ./extensions
# Render Free limits builds to 512 MiB. Keep pnpm fetch/link work serial.
RUN pnpm config set network-concurrency 1 \
    && pnpm config set child-concurrency 1 \
    && pnpm install --frozen-lockfile
COPY . .
ARG SHOPIFY_APP_URL
RUN NODE_ENV=production pnpm run build
RUN pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma ./prisma
COPY public ./public

EXPOSE 3000

CMD ["pnpm", "run", "docker-start"]
