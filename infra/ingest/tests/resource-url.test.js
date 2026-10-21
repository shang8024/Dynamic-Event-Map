import test from 'node:test';
import assert from 'node:assert/strict';
import { resourceDownloadURL, shouldRetryRevision } from '../resource-url.js';
const resource={url:'https://ckan0.cf.opendata.inter.prod-toronto.ca/dataset/example/download/file.json',last_modified:'2026-10-20T20:53:51'};
test('CDN retry preserves the trusted resource path and records a deterministic source revision',()=>{
  assert.equal(resourceDownloadURL(resource),resource.url);
  const retry=new URL(resourceDownloadURL(resource,true));
  assert.equal(retry.origin+retry.pathname,resource.url);
  assert.equal(retry.searchParams.get('eventmap_revision'),'2026-10-20T205351');
  assert.throws(()=>resourceDownloadURL({...resource,url:'https://example.test/feed.json'},true));
  assert.throws(()=>resourceDownloadURL({...resource,last_modified:''},true));
});
test('only transient resource HTTP errors permit a revision retry',()=>{
  for(const status of [502,503,504]) assert.equal(shouldRetryRevision({status,sourceURL:resource.url},resource.url),true);
  for(const status of [400,401,403,404,429]) assert.equal(shouldRetryRevision({status,sourceURL:resource.url},resource.url),false);
  assert.equal(shouldRetryRevision({status:502,sourceURL:'https://example.test/metadata'},resource.url),false);
});
