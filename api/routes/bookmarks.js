const express = require('express');
const router = express.Router({ mergeParams: true });
const bookmarksController = require('../controllers/bookmarksController');
const firebaseAuth = require('../middleware/auth');

// GET /api/bookmarks
router.get('/', firebaseAuth, bookmarksController.getBookmarks);

// POST /api/bookmarks/:eventId
router.post('/:eventId', firebaseAuth, bookmarksController.createBookmark);

// DELETE /api/bookmarks/:bookmarkId
router.delete('/:bookmarkId', firebaseAuth, bookmarksController.deleteBookmark);

// GET /api/bookmarks/today
router.get('/today', firebaseAuth, bookmarksController.getTodaysBookmarks);

// GET /api/bookmarks/stats/:eventId
router.get('/stats/:eventId', bookmarksController.getBookmarksStatsByEvent);

module.exports = router;
