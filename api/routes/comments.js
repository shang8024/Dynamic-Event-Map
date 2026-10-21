const express = require('express');
const router = express.Router({ mergeParams: true });
const commentsController = require('../controllers/commentsController');
const firebaseAuth = require('../middleware/auth');
const pool=require('../config/db');
const {createCommentPreviewHandler,isEventId}=require('../services/commentPreview');

router.get('/preview',createCommentPreviewHandler({db:pool,redis:require('../config/redis')}));

// GET /api/events/:eventId/comments
router.get('/snapshot', async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!isEventId(req.params.eventId)) return res.status(400).json({error:'Invalid event ID'});
  try {
    const {rows:[snapshot]}=await pool.query(`SELECT e.comment_revision revision,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'text',c.text,'createdAt',c.created_at,
        'user',jsonb_build_object('id',p.id,'name',p.username)) ORDER BY c.created_at DESC,c.id DESC)
      FROM comments c JOIN profiles p ON p.id=c.user_id WHERE c.event_id=e.id),'[]'::jsonb) comments
      FROM events e WHERE e.id=$1`,[req.params.eventId]);
    if(!snapshot) return res.status(404).json({error:'Event not found'});
    res.json(snapshot);
  } catch {res.status(503).json({error:'Unable to refresh comments'});}
});
router.get('/', commentsController.getComments);

// POST /api/events/:eventId/comments
router.post('/', firebaseAuth, commentsController.createComment);

// DELETE /api/events/:eventId/comments/:commentId
router.delete('/:commentId', firebaseAuth, commentsController.deleteComment);

module.exports = router;
