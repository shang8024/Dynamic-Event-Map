const express = require('express');
const firebaseAuth = require('../middleware/auth');
const router = express.Router();

// Sync endpoint: client sends Firebase ID token in Authorization header
// Middleware verifies token and upserts the user in the DB
router.post('/sync', firebaseAuth, async (req, res) => {
  res.json({ user: req.user });
});

// Get current authenticated user
router.get('/me', firebaseAuth, async (req, res) => {
  res.json(req.user);
});

module.exports = router;