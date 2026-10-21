const test=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const {EventEmitter}=require('node:events');
const {Readable}=require('node:stream');
const images=require('../services/eventImages');
const {ImageError,publicImageError}=require('../services/imageErrors');
test('image links reject scripts, userinfo, unexpected ports, hosts and misleading Toronto paths',()=>{
  for(const value of ['javascript:alert(1)','data:image/svg+xml,test','http://images.unsplash.com/a','https://127.0.0.1/a',
    'https://images.unsplash.com.attacker.test/a','https://attacker@images.unsplash.com/a','https://images.unsplash.com:8443/a',
    'https://secure.toronto.ca/admin','https://images.unsplash.com/a#script','https://images.unsplash.com\\@attacker.test/a']) assert.throws(()=>images.validateImageURL(value));
  assert.equal(images.validateImageURL('https://images.unsplash.com/photo-example?w=100').hostname,'images.unsplash.com');
});
test('all DNS answers must be public, including IPv6 and IPv4-mapped answers',async()=>{
  for(const address of ['127.0.0.1','0.0.0.0','10.0.0.1','172.16.1.1','192.168.1.1','169.254.169.254','100.64.0.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1']) assert.equal(images.isPublicAddress(address),false,address);
  assert.equal(images.isPublicAddress('8.8.8.8'),true);
  await assert.rejects(images.resolvePublic('images.unsplash.com',async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}]));
});
test('redirect targets are validated before a second request and the connection uses pinned DNS',async()=>{
  let count=0;
  const request=(_url,options,callback)=>{
    count++;options.lookup('images.unsplash.com',{},(error,address)=>{assert.equal(error,null);assert.equal(address,'8.8.8.8');});
    const req=new EventEmitter();req.end=()=>{
      const response=Readable.from([]);response.statusCode=302;response.headers={location:'https://169.254.169.254/latest/meta-data/'};callback(response);
    };return req;
  };
  await assert.rejects(images.downloadImage('https://images.unsplash.com/a',{lookup:async()=>[{address:'8.8.8.8',family:4}],request}));
  assert.equal(count,1);
});
test('only decoded still raster images are published, re-encoded without metadata',async()=>{
  for(const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),Buffer.from('<html>not a photo</html>')]) await assert.rejects(images.sanitizeImage(bytes));
  const input=await sharp({create:{width:200,height:100,channels:3,background:'#f80'}}).jpeg().withMetadata().toBuffer();
  const output=await images.sanitizeImage(input,'thumb');
  const info=await sharp(output).metadata();assert.equal(info.format,'webp');assert.equal(info.width,128);assert.equal(info.exif,undefined);
});
test('ended, cancelled and hidden events never trigger an image fetch',()=>{
  const data={imported_image:{url:'https://images.unsplash.com/test'}};
  assert.equal(images.sourceImage({data,ends_at:'2020-01-01'}),null);
  assert.equal(images.sourceImage({data,status:'cancelled'}),null);
  assert.equal(images.sourceImage({data:{...data,image_hidden:true}}),null);
});
test('image rejections have actionable public messages without exposing upstream details',async()=>{
  assert.equal(publicImageError(new Error('private DNS 10.0.0.9 or signed URL')).code,'IMAGE_SERVICE_UNAVAILABLE');
  assert.doesNotMatch(publicImageError(new Error('private DNS 10.0.0.9 or signed URL')).error,/10\.0|signed|DNS/);
  assert.throws(()=>images.validateImageURL('https://attacker.test/private'),error=>error.code==='IMAGE_HOST_NOT_ALLOWED');
  await assert.rejects(images.resolvePublic('images.unsplash.com',async()=>[{address:'169.254.169.254',family:4}]),error=>error.code==='IMAGE_ADDRESS_BLOCKED');
  await assert.rejects(images.sanitizeImage(Buffer.alloc(8*1024*1024+1)),error=>error.code==='IMAGE_TOO_LARGE');
  await assert.rejects(images.sanitizeImage(Buffer.from('<svg/>')),error=>error.code==='IMAGE_FORMAT_UNSUPPORTED');
  const image=await sharp({create:{width:4000,height:4000,channels:3,background:'#000'}}).png().toBuffer();
  await assert.rejects(images.sanitizeImage(image),error=>error.code==='IMAGE_TOO_LARGE');
  assert.match(publicImageError(new ImageError('IMAGE_TOO_LARGE')).error,/8 MB.*12 million pixels/);
});
test('isolated worker rejection reasons reach the API and production fails closed without a worker',async()=>{
  const http=require('node:http');const previous={url:process.env.IMAGE_PROXY_URL,mode:process.env.NODE_ENV,worker:process.env.IMAGE_PROXY_WORKER};
  const server=http.createServer((_req,res)=>{const body=JSON.stringify(publicImageError(new ImageError('IMAGE_TOO_LARGE')));res.writeHead(422,{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)});res.end(body);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    process.env.IMAGE_PROXY_URL=`http://127.0.0.1:${server.address().port}`;
    await assert.rejects(images.getImage('https://images.unsplash.com/test','thumb'),error=>error.code==='IMAGE_TOO_LARGE');
    delete process.env.IMAGE_PROXY_URL;delete process.env.IMAGE_PROXY_WORKER;process.env.NODE_ENV='production';
    await assert.rejects(images.getImage('https://images.unsplash.com/test','thumb'),error=>error.code==='IMAGE_SERVICE_UNAVAILABLE');
  } finally {
    for(const [key,value] of Object.entries({IMAGE_PROXY_URL:previous.url,NODE_ENV:previous.mode,IMAGE_PROXY_WORKER:previous.worker})) if(value===undefined) delete process.env[key];else process.env[key]=value;
    await new Promise(resolve=>server.close(resolve));
  }
});
