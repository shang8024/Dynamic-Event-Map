const express = require("express");
const cors = require("cors");
const eventsRoutes = require("./routes/events");
const statsRoutes = require("./routes/stats");

require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

app.use(express.json());
app.use(cors({ origin: `http://localhost:${process.env.FRONTEND_PORT || 3000}` }));

// Routes
app.use("/api/events", eventsRoutes);
app.use("/stats", statsRoutes);

// Start server
app.listen(port, () => console.log(`API running on http://localhost:${port}`));
