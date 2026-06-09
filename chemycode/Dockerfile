# ChemAgent — multi-stage build for production
#
# Stage 1: build the frontend (Vite)
# Stage 2: build the gateway server (tsx → tsc, but tsc isn't necessary for
#         production if we ship ESM with node loader; we use tsx in prod too)
# Final: install only runtime deps and copy built artefacts.

FROM node:22-alpine AS frontend
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && (pnpm install --frozen-lockfile || npm install)
COPY . .
RUN pnpm build || npm run build

FROM node:22-alpine AS backend
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN corepack enable && (pnpm install --prod --frozen-lockfile || npm install --omit=dev)
COPY --from=frontend /app/dist ./dist
COPY server ./server
COPY .env.example ./.env.example

ENV NODE_ENV=production
ENV PORT=8787
EXPOSE 8787

CMD ["node", "--import", "tsx/esm", "server/src/index.ts"]
