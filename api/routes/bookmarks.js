const express = require('express');
const router = express.Router({ mergeParams: true });
const bookmarksController = require('../controllers/bookmarksController');

// GET /api/bookmarks
router.post('/', bookmarksController.getBookmarks);

// POST /api/bookmarks
router.post('/add', bookmarksController.createBookmark);

// DELETE /api/bookmarks/:eventId
router.delete('/:eventId', bookmarksController.deleteBookmark);

module.exports = router;
