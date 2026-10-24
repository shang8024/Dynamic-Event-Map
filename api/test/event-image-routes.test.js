const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const express=require('express');
const images=require('../services/eventImages');
const {ImageError,publicImageError}=require('../services/imageErrors');

function imageRoute({event,error}) {
  let downloads=0,released=false;const queries=[];
  const db={async query(sql) {queries.push(sql);return {rows:sql.startsWith('SELECT')?[event].filter(Boolean):[]};},release(){released=true;}};
  const dependencies={'express':express,'../middleware/auth':(_req,_res,next)=>next(),
    '../config/db':{connect:async()=>db,query:(...args)=>db.query(...args)},'../services/eventPermissions':require('../services/eventPermissions'),
    '../services/eventImages':{...images,async getImage(){downloads++;throw error;}},
    '../services/imageDelivery':{async getDeliveredImage(){downloads++;if(error)throw error;return Buffer.from('image');}},
    '../services/imageErrors':require('../services/imageErrors')};
  const filename=path.resolve(__dirname,'../routes/eventImages.js'),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];}},{filename});
  const handler=module.exports.stack.find(item=>item.route?.methods.put).route.stack.at(-1).handle;
  const get=module.exports.stack.find(item=>item.route?.methods.get).route.stack.at(-1).handle;
  return {handler,get,queries,stats:()=>({downloads,released})};
}
function response() {return {statusCode:200,headers:{},set(key,value){if(typeof key==='object')Object.assign(this.headers,key);else this.headers[key]=value;return this;},status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;},send(body){this.body=body;return this;},sendStatus(code){this.statusCode=code;return this;}};}
test('a rejected image returns its safe reason, rolls back and leaves the current photo unchanged',async()=>{
  for(const code of ['IMAGE_TOO_LARGE','IMAGE_FORMAT_UNSUPPORTED','IMAGE_TIMEOUT','IMAGE_ADDRESS_BLOCKED']) {
    const route=imageRoute({event:{id:1,user_id:10,title:'Existing event',data:{image:{url:'old'}}},error:new ImageError(code)});
    const res=response();await route.handler({params:{eventId:1},body:{url:'https://images.unsplash.com/test'},user:{id:10,role:'member'}},res);
    assert.equal(res.statusCode,422);assert.equal(res.body.code,code);assert.equal(res.body.error,publicImageError(new ImageError(code)).error);
    assert.equal(route.stats().downloads,1);assert.equal(route.stats().released,true);
    assert.ok(route.queries.includes('ROLLBACK'));assert.ok(!route.queries.some(sql=>/^UPDATE|^INSERT/.test(sql)));
  }
});
test('unsupported links and another user cannot cause an image download',async()=>{
  const route=imageRoute({event:{id:1,user_id:20}}),bad=response();
  await route.handler({params:{eventId:1},body:{url:'https://attacker.example/private'},user:{id:10}},bad);
  assert.equal(bad.statusCode,400);assert.equal(bad.body.code,'IMAGE_HOST_NOT_ALLOWED');assert.equal(route.stats().downloads,0);
  const denied=response();await route.handler({params:{eventId:1},body:{url:'https://images.unsplash.com/test'},user:{id:10,role:'member'}},denied);
  assert.equal(denied.statusCode,403);assert.equal(route.stats().downloads,0);
});
test('public image reads distinguish temporary service pressure from a rejected photo and never cache errors',async()=>{
  for(const [code,status] of [['IMAGE_BUSY',503],['IMAGE_TIMEOUT',504],['IMAGE_INVALID',422]]) {
    const route=imageRoute({event:{id:1,data:{image:{url:'https://images.unsplash.com/test'}}},error:new ImageError(code)}),res=response();
    await route.get({params:{eventId:'1'},query:{size:'thumb'}},res);
    assert.equal(res.statusCode,status);assert.equal(res.body.code,code);assert.equal(res.headers['Cache-Control'],'no-store');
    if(status>=500)assert.equal(res.headers['Retry-After'],'2');
  }
});
test('archived-image eligibility is checked before the shared cache and expiry bounds browser caching',async()=>{
  for(const event of [{ends_at:'2020-01-01'},{status:'cancelled'},{data:{image_hidden:true}}]) {
    const route=imageRoute({event:{data:{image:{url:'https://images.unsplash.com/test'}},...event}}),res=response();
    await route.get({params:{eventId:'1'},query:{}},res);assert.equal(res.statusCode,404);assert.equal(route.stats().downloads,0);
  }
  const route=imageRoute({event:{ends_at:new Date(Date.now()+30000),data:{image:{url:'https://images.unsplash.com/test'}}}}),res=response();
  await route.get({params:{eventId:'1'},query:{size:'thumb'}},res);assert.ok(Number(res.headers['Cache-Control'].split('=')[1])<=30);
});
