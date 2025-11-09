const express = require('express');
const router = express.Router({ mergeParams: true });
const commentsController = require('../controllers/commentsController');
const firebaseAuth = require('../middleware/auth');

// GET /api/events/:eventId/comments
router.get('/', commentsController.getComments);

// POST /api/events/:eventId/comments
router.post('/', firebaseAuth, commentsController.createComment);

// DELETE /api/events/:eventId/comments/:commentId
router.delete('/:commentId', firebaseAuth, commentsController.deleteComment);

module.exports = router;
