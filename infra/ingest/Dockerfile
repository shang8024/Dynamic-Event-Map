FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --chown=node:node *.js ./
USER node
CMD ["node", "update_toronto_events.js", "--write"]
