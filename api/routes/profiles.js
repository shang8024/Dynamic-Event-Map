const express = require('express');
const profilesController = require('../controllers/profilesController');
const router = express.Router();
const firebaseAuth = require('../middleware/auth');

router.post('/', firebaseAuth, profilesController.addUser);
router.get('/:uid', firebaseAuth, profilesController.getUserByUid);

module.exports = router;
