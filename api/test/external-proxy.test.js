const test=require('node:test'),assert=require('node:assert/strict');
const {getTorontoEvents}=require('../controllers/externalEventsController');
test('the obsolete public Toronto route never starts an external download',async()=>{
  const original=global.fetch;global.fetch=()=>assert.fail('public request must not trigger source download');
  try {
    const res={code:200,set(){return this;},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await getTorontoEvents({query:{from:'anything',to:'anything'}},res);
    assert.equal(res.code,410);assert.match(res.body.error,/\/api\/events/);
  } finally {global.fetch=original;}
});
