const express = require('express');
const router = express.Router({ mergeParams: true });
const commentsController = require('../controllers/commentsController');

// GET /api/events/:eventId/comments
router.get('/', commentsController.getComments);

// POST /api/events/:eventId/comments
router.post('/', commentsController.createComment);

// DELETE /api/events/:eventId/comments/:commentId
router.delete('/:commentId', commentsController.deleteComment);

module.exports = router;
