FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm i --omit=dev; fi

FROM node:22-alpine
RUN apk add --no-cache netcat-openbsd
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN chmod +x wait-for-redis.sh && sed -i 's/\r$//' wait-for-redis.sh
EXPOSE 5000
USER node
CMD ["sh", "wait-for-redis.sh"]