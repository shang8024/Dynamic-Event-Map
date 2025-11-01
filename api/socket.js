let io = null;

function init(server, opts = {}) {
  const { Server } = require("socket.io");
  io = new Server(server, {
    cors: {
      origin: opts.origin || `http://localhost:${process.env.FRONTEND_PORT || 3000}`,
      methods: ["GET", "POST"],
    },
  });

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);
    socket.on("disconnect", (reason) => console.log("Socket disconnected:", socket.id, reason));
  });

  return io;
}

function getIO() {
  if (!io) throw new Error("Socket.io not initialized. Call init(server) first.");
  return io;
}

module.exports = { init, getIO };
