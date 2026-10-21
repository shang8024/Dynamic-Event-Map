const http=require('node:http');
const {getImage}=require('../services/eventImages');
const {ImageError,publicImageError}=require('../services/imageErrors');
if(process.env.NODE_ENV==='production' && process.env.IMAGE_PROXY_WORKER!=='true') throw new Error('Image worker mode is required');
const server=http.createServer(async(req,res)=>{
  if(req.method==='GET' && req.url==='/healthz') {res.writeHead(200,{'Content-Type':'application/json'});return res.end('{"status":"ok"}');}
  if(req.method!=='POST' || req.url!=='/render') {res.writeHead(404);return res.end();}
  try {
    const chunks=[];let bytes=0;
    for await(const chunk of req) {bytes+=chunk.length;if(bytes>6000) throw new ImageError('IMAGE_URL_INVALID');chunks.push(chunk);}
    const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if(!['thumb','detail'].includes(value.size)) throw new ImageError('IMAGE_URL_INVALID');
    const image=await getImage(value.url,value.size);
    if(image.length>2*1024*1024) throw new ImageError('IMAGE_TOO_LARGE');
    res.writeHead(200,{'Content-Type':'image/webp','Content-Length':image.length,'X-Content-Type-Options':'nosniff'});res.end(image);
  } catch(error) {
    const body=JSON.stringify(publicImageError(error));
    if(!res.headersSent) res.writeHead(422,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)});
    res.end(body);
  }
});
server.requestTimeout=15000;server.headersTimeout=10000;server.keepAliveTimeout=5000;server.maxRequestsPerSocket=100;
server.listen(Number(process.env.PORT||5100),'0.0.0.0',()=>console.log('Isolated image proxy ready'));
