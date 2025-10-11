# api/Dockerfile
FROM node:22
WORKDIR /app
# Copy only manifests first for better layer caching
COPY package*.json ./
# Install deps
RUN npm install

COPY . .

# Default port in your code is 5000
EXPOSE 5000

# Start the server
CMD ["node", "index.js"]
