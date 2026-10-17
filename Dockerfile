# Mog Share: single container (signaling server + built web app)
FROM node:22-alpine
WORKDIR /app
COPY . .
RUN npm install --no-audit --no-fund && npm run build
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
CMD ["npm", "start"]
