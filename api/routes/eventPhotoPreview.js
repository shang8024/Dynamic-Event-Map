const router=require('express').Router();
const auth=require('../middleware/auth');
const {preparePhoto}=require('../services/eventPhotoInput');
const {publicImageError}=require('../services/imageErrors');
router.post('/event-photo-preview',auth,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try {
    const {bytes}=await preparePhoto(req.body);
    res.json({preview:`data:image/webp;base64,${bytes.toString('base64')}`});
  } catch(error) {res.status(error.status||422).json(publicImageError(error));}
});
module.exports=router;
