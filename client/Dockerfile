FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm i; fi
COPY . .
ARG REACT_APP_API_BASE_URL=
ENV REACT_APP_API_BASE_URL=$REACT_APP_API_BASE_URL
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/build /usr/share/nginx/html
RUN printf 'server { \
  listen 80; server_name _; \
  root /usr/share/nginx/html; index index.html; \
  location / { try_files $uri /index.html; } \
}\n' > /etc/nginx/conf.d/default.conf
EXPOSE 80
