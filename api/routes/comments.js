const express = require('express');
const router = express.Router({ mergeParams: true });
const commentsController = require('../controllers/commentsController');
const firebaseAuth = require('../middleware/auth');

// GET /api/events/:eventId/comments
router.get('/snapshot', async(req,res)=>{
  try {
    const pool=require('../config/db');
    const {rows:[snapshot]}=await pool.query(`SELECT e.comment_revision revision,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'text',c.text,'createdAt',c.created_at,
        'user',jsonb_build_object('id',p.id,'name',p.username)) ORDER BY c.created_at DESC,c.id DESC)
      FROM comments c JOIN profiles p ON p.id=c.user_id WHERE c.event_id=e.id),'[]'::jsonb) comments
      FROM events e WHERE e.id=$1`,[req.params.eventId]);
    if(!snapshot) return res.status(404).json({error:'Event not found'});
    res.set('Cache-Control','no-store').json(snapshot);
  } catch {res.status(503).json({error:'Unable to refresh comments'});}
});
router.get('/', commentsController.getComments);

// POST /api/events/:eventId/comments
router.post('/', firebaseAuth, commentsController.createComment);

// DELETE /api/events/:eventId/comments/:commentId
router.delete('/:commentId', firebaseAuth, commentsController.deleteComment);

module.exports = router;
