FROM node:22-alpine

RUN apk add --no-cache docker-cli

WORKDIR /app

COPY package.json ./
COPY tsup.config.ts ./
COPY tsconfig.json ./
COPY src ./src

RUN npm install
RUN npm run build

ENV NODE_ENV=production
ENV GATEWAY_PORT=3002

EXPOSE 3002

CMD ["node", "dist/index.js"]
