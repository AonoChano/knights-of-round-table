FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY pnpm-lock.yaml* ./
COPY tsconfig.json ./
COPY next.config.ts ./
COPY postcss.config.js ./
COPY tailwind.config.ts ./
COPY next-env.d.ts ./
COPY app ./app

RUN corepack enable && corepack prepare pnpm@10.10.0 --activate
RUN pnpm install --no-frozen-lockfile

CMD ["pnpm", "dev", "--hostname", "0.0.0.0", "--port", "3000"]
