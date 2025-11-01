const express = require("express");
const cors = require("cors");
const eventsRoutes = require("./routes/events");
const commentsRoutes = require("./routes/comments");
const statsRoutes = require("./routes/stats");
const externalEventsRoutes = require("./routes/externalEvents");

require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors({ origin: `http://localhost:${process.env.FRONTEND_PORT || 3000}` }));

// Routes
app.use("/api/events", eventsRoutes);
// Nested comments route: /api/events/:eventId/comments
app.use('/api/events/:eventId/comments', commentsRoutes);
app.use("/stats", statsRoutes);
app.use("/events/external", externalEventsRoutes);

// Start server with socket.io
const http = require("http");
const server = http.createServer(app);
const socket = require("./socket");
socket.init(server);

server.listen(port, () => console.log(`API running on http://localhost:${port}`));
