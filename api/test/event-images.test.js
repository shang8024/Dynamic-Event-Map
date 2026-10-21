const test=require('node:test');
const assert=require('node:assert/strict');
const sharp=require('sharp');
const {EventEmitter}=require('node:events');
const {Readable}=require('node:stream');
const images=require('../services/eventImages');
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
