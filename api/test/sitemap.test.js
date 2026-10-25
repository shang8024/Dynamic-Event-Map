const test=require('node:test'),assert=require('node:assert/strict');
const {createSitemap,sitemapDocument,SITEMAP_QUERY,ORIGIN}=require('../services/sitemap');
function response(){return {headers:{},statusCode:200,set(key,value){this.headers[key]=value;return this;},status(code){this.statusCode=code;return this;},type(value){this.contentType=value;return this;},send(body){this.body=body;return this;},end(){return this;}};}
const request=etag=>({get:name=>name==='If-None-Match'?etag:'https://attacker.example'});
const at=Date.parse('2026-10-24T12:00:00Z');

test('sitemap uses only canonical public URLs and genuine event modification dates',()=>{
  const body=sitemapDocument([
    {id:1,updated_at:'2026-10-23T12:00:00Z',title:'<script>',email:'private@example.test'},
    {id:2,updated_at:'invalid',ends_at:null},
    {id:3,updated_at:'2030-01-01T12:00:00Z'},
    {id:4,ends_at:'2026-10-24T11:00:00Z'},
  ],at);
  assert.match(body,/^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(body,/<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
  assert.equal((body.match(/<url>/g)||[]).length,4);
  assert.match(body,new RegExp(`<loc>${ORIGIN}/events/1</loc><lastmod>2026-10-23T12:00:00.000Z</lastmod>`));
  assert.doesNotMatch(body,/events\/4|private|script|2030|invalid|changefreq|priority/);
  assert.ok(body.includes(`<loc>${ORIGIN}/events/2</loc></url>`),'unknown end times are retained without guessing');
  assert.throws(()=>sitemapDocument([{id:'1</loc><script>'}],at),/Invalid/);
  assert.throws(()=>sitemapDocument(Array(50000).fill({id:1}),at),/pagination/);
});

test('sitemap coalesces crawler requests, ignores supplied hosts and revalidates at a known expiry',async()=>{
  let clock=at,reads=0;
  const handler=createSitemap({now:()=>clock,db:{async query(options){reads++;assert.equal(options.text,SITEMAP_QUERY);assert.equal(options.query_timeout,3000);
    return {rows:[{id:1,ends_at:new Date(at+1000)},{id:2,ends_at:null}]};}}});
  const a=response(),b=response();await Promise.all([handler(request(),a),handler(request(),b)]);
  assert.equal(reads,1);assert.equal(a.contentType,'application/xml');assert.equal(a.body,b.body);assert.ok(a.body.includes(ORIGIN));assert.ok(!a.body.includes('attacker'));
  assert.equal(a.headers['Cache-Control'],'public, max-age=1, must-revalidate');
  const unchanged=response();await handler(request(`W/${a.headers.ETag}`),unchanged);assert.equal(unchanged.statusCode,304);assert.equal(unchanged.body,undefined);assert.equal(reads,1);
  clock+=1001;const expired=response();await handler(request(a.headers.ETag),expired);assert.equal(reads,2);assert.equal(expired.statusCode,200);
  assert.ok(!expired.body.includes('/events/1<'));assert.ok(expired.body.includes('/events/2<'));assert.notEqual(expired.headers.ETag,a.headers.ETag);
});

test('database failure is retryable and never publishes an empty sitemap or serves an expired snapshot',async()=>{
  let clock=at,failed=false;
  const handler=createSitemap({now:()=>clock,db:{async query(){if(failed)throw new Error('private database details');return {rows:[{id:1}]};}}});
  await handler(request(),response());clock+=60001;failed=true;
  const error=response();await handler(request(),error);assert.equal(error.statusCode,503);assert.equal(error.headers['Retry-After'],'60');assert.equal(error.headers['Cache-Control'],'no-store');assert.doesNotMatch(error.body,/private|<urlset/);
  failed=false;const recovered=response();await handler(request(),recovered);assert.equal(recovered.statusCode,200);assert.match(recovered.body,/<urlset/);
});

test('real database sitemap includes one URL per active series and excludes cancelled, archived and ended events',
  {skip:process.env.NOTIFICATION_DB_TEST!=='1'},async()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');assert.ok(['55432','55433'].includes(process.env.PGPORT));
  const {Pool}=require('pg'),fs=require('node:fs/promises'),path=require('node:path');
  const schema=`sitemap_test_${process.pid}`,admin=new Pool({max:1}),db=new Pool({options:`-c search_path=${schema}`});
  await admin.query(`CREATE SCHEMA ${schema}`);
  try {
    await db.query(await fs.readFile(path.resolve(__dirname,'../../db/init.sql'),'utf8'));
    for(const file of (await fs.readdir(path.resolve(__dirname,'../../db/migrations'))).filter(name=>/^\d.*\.sql$/.test(name)).sort())
      await db.query(await fs.readFile(path.resolve(__dirname,'../../db/migrations',file),'utf8'));
    const {createEventModel}=require('../models/eventModel'),model=createEventModel(db),base=Date.now(),date=hours=>new Date(base+hours*3600000).toISOString();
    const owner=(await db.query("INSERT INTO profiles(username,email) VALUES('sitemap-owner','private@example.test') RETURNING id")).rows[0];
    const series=(await model.create({user_id:owner.id,title:'Several dates',description:'Public series',category:'Other',lat:43.7,lng:-79.4,location_address:'Toronto',
      occurrences:[{starts_at:date(-2),ends_at:date(-1)},{starts_at:date(2),ends_at:date(3)}]})).rows[0];
    const {rows:fixtures}=await db.query(`INSERT INTO events(user_id,title,source,starts_at,ends_at,status,archived_at) VALUES
      ($1,'Unknown end','internal',$2,NULL,'scheduled',NULL),
      ($1,'Official ongoing','external',$2,$3,'scheduled',NULL),
      ($1,'Ended','external',$2,$4,'scheduled',NULL),
      ($1,'Cancelled','internal',$2,$3,'cancelled',NULL),
      ($1,'Archived','internal',$2,$3,'scheduled',now()) RETURNING id`,[owner.id,date(-2),date(3),date(-1)]);
    const rows=(await db.query(SITEMAP_QUERY)).rows;
    assert.deepEqual(rows.map(row=>row.id),[series.id,fixtures[0].id,fixtures[1].id]);
    assert.ok(rows.every(row=>Object.keys(row).sort().join(',')==='ends_at,id,updated_at'));
    const body=sitemapDocument(rows);assert.equal((body.match(/<url>/g)||[]).length,4);assert.equal((body.match(new RegExp(`/events/${series.id}<`,'g'))||[]).length,1);
    assert.ok(!body.includes('private@example.test'));
  } finally {await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await require('../config/db').end();}
});
