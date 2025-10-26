FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci; else npm i; fi
COPY . .
# Inject frontend config at build time
ARG VITE_API_BASE_URL=/api
ARG VITE_GOOGLE_MAPS_KEY=
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
ENV VITE_GOOGLE_MAPS_KEY=$VITE_GOOGLE_MAPS_KEY
RUN npm run build

# ---- serve (nginx) ----
FROM nginx:alpine
# Prod Nginx
COPY nginx/nginx-prod.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
