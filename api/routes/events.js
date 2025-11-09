const express = require("express");
const router = express.Router();
const eventsController = require("../controllers/eventsController");
const firebaseAuth = require('../middleware/auth');

router.get("/", eventsController.getEvents);
router.post("/", firebaseAuth, eventsController.createEvent);
router.delete("/:id", firebaseAuth, eventsController.deleteEvent);
router.put("/:id", firebaseAuth, eventsController.updateEvent);

module.exports = router;
