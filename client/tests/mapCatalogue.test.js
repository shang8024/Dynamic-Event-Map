import test from 'node:test';
import assert from 'node:assert/strict';
import {createMapCatalogueClient} from '../src/services/mapCatalogue.js';
test('catalogue sends no credentials and 304 preserves the exact row array; caches are isolated by search',async()=>{
  const calls=[],fetchMap=createMapCatalogueClient({fetchImpl:async(url,options)=>{
    calls.push({url,options});return options.headers['If-None-Match']?new Response(null,{status:304}):Response.json([{id:calls.length}],{headers:{ETag:'"revision"'}});
  }});
  const first=await fetchMap();assert.equal(await fetchMap(),first);
  const searched=await fetchMap(' Library ');assert.notEqual(first,searched);assert.equal(await fetchMap('library'),searched);
  assert.equal(calls[2].url,'/api/events/map?q=library');assert.equal(calls[1].options.headers['If-None-Match'],'"revision"');
  assert.ok(calls.every(call=>call.options.credentials==='omit'&&!call.options.headers.Authorization));
});
test('cancelled catalogue responses do not replace cached data',async()=>{
  const controller=new AbortController(),fetchMap=createMapCatalogueClient({fetchImpl:async()=>{controller.abort();return Response.json([{id:1}],{headers:{ETag:'"new"'}});}});
  await assert.rejects(fetchMap('',{signal:controller.signal}),error=>error.name==='AbortError');
});
