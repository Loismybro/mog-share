FROM node:22-alpine AS builder

WORKDIR /app
COPY package*.json ./
COPY packages/client/package*.json ./packages/client/
COPY packages/server/package*.json ./packages/server/

RUN npm install

COPY . .
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

COPY package*.json ./
COPY packages/server/package*.json ./packages/server/
RUN npm install --omit=dev --workspace=packages/server

COPY --from=builder /app/packages/server/src ./packages/server/src
COPY --from=builder /app/packages/client/dist ./packages/client/dist
COPY --from=builder /app/dist ./dist

EXPOSE 4000

CMD ["npx", "tsx", "packages/server/src/index.ts"]
