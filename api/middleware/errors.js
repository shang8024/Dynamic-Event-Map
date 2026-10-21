function apiErrors(error,_req,res,next) {
  if(res.headersSent) return next(error);
  let status=500,message='Unable to complete the request. Please try again.';
  if(error.type==='entity.parse.failed') {status=400;message='Invalid JSON request body';}
  else if(error.type==='entity.too.large') {status=413;message='Request body is too large';}
  else if(error.status===403) {status=403;message='This request origin is not allowed';}
  else if(error instanceof URIError) {status=400;message='Invalid request URL';}
  // Never echo dependency messages, request bodies, or development stack traces.
  if(status===500) console.error('Unhandled API error',error.code||error.name||'Error');
  res.status(status).json({message});
}
module.exports=apiErrors;
