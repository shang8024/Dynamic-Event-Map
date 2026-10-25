// API responses supply the app; they are not search landing pages.
module.exports=(_req,res,next)=>{res.set('X-Robots-Tag','noindex, follow');next();};
