// routes/externalEvents.js
const express = require("express");
const router = express.Router();
const external = require("../controllers/externalEventsController");

router.get("/", external.getTorontoEvents);

module.exports = router;
