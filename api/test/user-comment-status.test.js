const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function controller(model) {
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../controllers/commentsController.js'),'utf8'),{module,console,
    require(name){return {'../models/commentModel':model,'../config/db':{},'../socket':{}}[name];}});
  return module.exports.getUserComments;
}
const response=()=>({code:200,status(code){this.code=code;return this;},json(body){this.body=body;return this;}});

test('my comments preserve cancelled and archived event states across the API projection',async()=>{
  const rows=[{id:1,event_id:7,title:'Cancelled event',text:'A comment',status:'cancelled',archived_at:null},
    {id:2,event_id:8,title:'Archived event',text:'Another comment',status:'scheduled',archived_at:'2026-10-01T00:00:00Z'}];
  const res=response();await controller({getByUser:async id=>{assert.equal(id,3);return {rows};}})({user:{id:3}},res);
  assert.equal(res.code,200);assert.equal(res.body[0].event.status,'cancelled');
  assert.equal(res.body[1].event.archived_at,'2026-10-01T00:00:00Z');
  assert.equal(res.body[0].comment.text,'A comment');
});

test('the user-comment query selects the status fields used by every activity badge',async()=>{
  let query;
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../models/commentModel.js'),'utf8'),{module,
    require(){return {query:async(sql,params)=>{query={sql,params};return {rows:[]};}};}});
  await module.exports.getByUser(4);
  assert.match(query.sql,/e\.status/);assert.match(query.sql,/e\.archived_at/);assert.equal(query.params[0],4);
});
