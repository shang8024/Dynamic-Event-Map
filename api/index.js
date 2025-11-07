const express = require("express");
const cors = require("cors");
const eventsRoutes = require("./routes/events");
const commentsRoutes = require("./routes/comments");
const statsRoutes = require("./routes/stats");
const bookmarksRoutes = require("./routes/bookmarks");
const externalEventsRoutes = require("./routes/externalEvents");
const authRoutes = require("./routes/auth");
const profilesRoutes = require("./routes/profiles");

require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());

// Simple CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction) {
      // In production: allow same-origin requests and configured allowed origins
      const allowedOrigins = [
        process.env.ALLOWED_ORIGINS, // From environment variable
      ].filter(Boolean); // Remove any undefined values
      
      // Allow same-origin requests (no origin header) OR requests from allowed origins
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked cross-origin request from: ${origin}`);
        callback(new Error('Cross-origin requests not allowed'));
      }
    } else {
      // In development, allow localhost
      const allowedOrigins = [`http://localhost:${process.env.FRONTEND_PORT || 3000}`];
      
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked request from origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    }
  },
  credentials: false,
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// Routes
app.use("/api/events", eventsRoutes);
// Nested comments route: /api/events/:eventId/comments
app.use('/api/events/:eventId/comments', commentsRoutes);
app.use("/stats", statsRoutes);
app.use("/events/external", externalEventsRoutes);
app.use("/api/bookmarks", bookmarksRoutes);
app.use("/auth", authRoutes);
app.use("/api/profiles", profilesRoutes);

// Start server with socket.io
const http = require("http");
const server = http.createServer(app);
const socket = require("./socket");
socket.init(server);

server.listen(port, () => console.log(`API running on http://localhost:${port}`));
