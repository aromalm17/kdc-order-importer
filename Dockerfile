FROM node:20-alpine
RUN apk add --no-cache openssl

EXPOSE 3000

WORKDIR /app

ENV NODE_ENV=production
ENV NODE_OPTIONS=--max-old-space-size=384

COPY package.json package-lock.json* ./

RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY . .

RUN npm run build

CMD ["node", "node_modules/@react-router/serve/bin.js", "./build/server/index.js"]
