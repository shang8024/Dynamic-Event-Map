const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function controller(model) {
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../controllers/eventsController.js'),'utf8'),{module,console,
    require(name){return {'../models/eventModel':model,'../socket':{},'./statsController':{},'../services/eventPermissions':{},'../services/eventSchedule':{}}[name];}});
  return module.exports.getEvent;
}
function response(){return {code:200,headers:{},set(key,value){this.headers[key]=value;return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};}
test('a standalone event returns the hydrated row including occurrence and archived history',async()=>{
  const row={id:7,title:'Event',author_name:'Official',archived_at:'2026-10-01T12:00:00Z',occurrences:[{starts_at:'2026-09-01T12:00:00Z',ends_at:'2026-09-01T13:00:00Z'}]};
  const get=controller({async getById(id){assert.equal(id,'7');return {rows:[row]};}}),res=response();
  await get({params:{id:'7'}},res);assert.equal(res.code,200);assert.equal(res.body,row);assert.equal(res.headers['Cache-Control'],'no-store');
});
test('unknown events are 404, invalid event IDs are 400 and outages are retryable',async()=>{
  const absent=response();await controller({async getById(){return {rows:[]};}})({params:{id:'7'}},absent);assert.equal(absent.code,404);
  for(const id of ['0','-1','01','2147483648','external','1;SELECT']) {
    const res=response();await controller({getById(){assert.fail('invalid lookup');}})({params:{id}},res);assert.equal(res.code,400);
  }
  const failed=response();await controller({async getById(){throw new Error('private');}})({params:{id:'7'}},failed);
  assert.equal(failed.code,503);assert.doesNotMatch(JSON.stringify(failed.body),/private/);
});
