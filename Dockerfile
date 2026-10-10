# Mog Share — single-container deployment (server + built client)
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm install --no-audit --no-fund

COPY . .
RUN npm run build:client

ENV PORT=4000
EXPOSE 4000
CMD ["npm", "start"]
