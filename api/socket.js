// socket.js
let io = null;

function init(server, opts = {}) {
  const { Server } = require("socket.io");
  const { createAdapter } = require("@socket.io/redis-adapter");
  const { createClient } = require("redis");
  const fs = require("fs");

  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : [];
  const allOrigins = Array.from(new Set([
    `http://localhost`,
    `http://localhost:${process.env.FRONTEND_PORT || 3000}`,
    ...allowedOrigins
  ].filter(Boolean)));

  io = new Server(server, {
    cors: {
      origin: allOrigins,
      methods: ["GET", "POST"],
      credentials: false
    },
    transports: ["polling", "websocket"],
    path: "/socket.io/",
  });

  // Setup Redis adapter for multi-instance support
  const redisHost = process.env.REDIS_HOST || "redis";
  const redisPort = Number(process.env.REDIS_PORT || 6379);
  const passwordFile = process.env.REDIS_PASSWORD_FILE;
  const password =
    (passwordFile && fs.existsSync(passwordFile) && fs.readFileSync(passwordFile, 'utf8').trim()) ||
    (process.env.REDIS_PASSWORD && process.env.REDIS_PASSWORD.trim()) ||
    undefined;

  // Create Redis clients for Socket.IO adapter with reconnection strategy
  const pubClient = createClient({
    socket: {
      host: redisHost,
      port: redisPort,
      reconnectStrategy: (retries) => {
        if (retries > 20) {
          console.error("[Socket.IO Redis Pub] Max reconnection attempts reached");
          return new Error("Max reconnection attempts reached");
        }
        const delay = Math.min(retries * 100, 3000);
        console.log(`[Socket.IO Redis Pub] Reconnecting in ${delay}ms (attempt ${retries})...`);
        return delay;
      }
    },
    database: 1, // Socket.IO uses db 1
    ...(password ? { password } : {})
  });
  
  const subClient = pubClient.duplicate();

  // Connect with retry logic
  const connectWithRetry = async (maxRetries = 10) => {
    for (let i = 0; i < maxRetries; i++) {
      try {
        console.log(`[Socket.IO] Connecting to Redis (attempt ${i + 1}/${maxRetries})...`);
        await Promise.all([pubClient.connect(), subClient.connect()]);
        console.log("[Socket.IO] Redis adapter connected");
        io.adapter(createAdapter(pubClient, subClient));
        return;
      } catch (err) {
        console.error(`[Socket.IO] Redis connection failed (attempt ${i + 1}/${maxRetries}):`, err.message);
        if (i < maxRetries - 1) {
          const delay = Math.min((i + 1) * 1000, 5000);
          console.log(`[Socket.IO] Retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.error("[Socket.IO] Redis adapter connection failed after all retries");
        }
      }
    }
  };

  connectWithRetry();

  pubClient.on("error", (err) => console.error("[Socket.IO Redis Pub] Error:", err));
  subClient.on("error", (err) => console.error("[Socket.IO Redis Sub] Error:", err));
  pubClient.on("reconnecting", () => console.log("[Socket.IO Redis Pub] Reconnecting..."));
  subClient.on("reconnecting", () => console.log("[Socket.IO Redis Sub] Reconnecting..."));

  io.on("connection", (socket) => {
    console.log(`Socket connected: ${socket.id}`);

    socket.on("joinEventRoom", (eventId) => {
      socket.join(`event_${eventId}`);
      console.log(`Socket ${socket.id} joined room event_${eventId}`);
    });
    socket.on("leaveEventRoom", (eventId) => {
      socket.leave(`event_${eventId}`);
      console.log(`Socket ${socket.id} left room event_${eventId}`);
    });

    socket.on("disconnect", (reason) => {
      console.log(`Socket disconnected: ${socket.id}, reason: ${reason}`);
    });
  });

  return io;
}

function getIO() {
  if (!io) throw new Error("Socket.io not initialized. Call init(server) first.");
  return io;
}

module.exports = { init, getIO };