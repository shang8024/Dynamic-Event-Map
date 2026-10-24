const express = require("express");
const router = express.Router();
const eventsController = require("../controllers/eventsController");
const firebaseAuth = require('../middleware/auth');

router.get("/", eventsController.getEvents);
router.get('/map', require('../services/mapCatalogue').createMapCatalogue(require('../models/eventModel')));
router.get("/:id", eventsController.getEvent);
router.post("/", firebaseAuth, eventsController.createEvent);
router.delete("/:id", firebaseAuth, eventsController.deleteEvent);
router.put("/:id", firebaseAuth, eventsController.updateEvent);

module.exports = router;
