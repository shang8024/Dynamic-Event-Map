let io = null;

function init(server, opts = {}) {
  const { Server } = require("socket.io");
  
  // Parse allowed origins properly
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map((o) => o.trim())
    : [];
  
  const allOrigins = Array.from(new Set([
    `http://localhost`,
    `http://localhost:${process.env.FRONTEND_PORT || 3000}`,
    ...allowedOrigins
  ].filter(Boolean)));
  
  console.log("Socket.IO CORS allowed origins:", allOrigins);
  
  io = new Server(server, {
    cors: {
      origin: allOrigins,
      methods: ["GET", "POST"],
      credentials: false
    },
    transports: ["websocket", "polling"],
    path: "/socket.io/"
  });

  io.on("connection", (socket) => {
    const origin = socket.handshake.headers.origin || socket.handshake.headers.referer;
    console.log(`Socket connected: ${socket.id} from ${origin}`);
    
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
