FROM node:20-alpine AS base

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
RUN pnpm prisma generate

COPY src ./src
COPY scripts ./scripts
COPY tsconfig.json ./

RUN pnpm build

FROM node:20-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=base /app/dist ./dist
COPY --from=base /app/prisma ./prisma

CMD ["node", "dist/index.js"]
