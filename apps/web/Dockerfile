FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /workspace

FROM base AS deps
COPY package.json pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --no-frozen-lockfile

FROM base AS dev
ENV NODE_ENV=development
COPY --from=deps /workspace/node_modules ./node_modules
COPY --from=deps /workspace/apps/web/node_modules ./apps/web/node_modules
COPY package.json pnpm-workspace.yaml ./
COPY apps/web ./apps/web
EXPOSE 3000
CMD ["pnpm", "--filter", "@starface/web", "dev"]
