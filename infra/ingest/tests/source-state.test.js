import test from 'node:test';
import assert from 'node:assert/strict';
import { canSkipDownload, sourceRevision, IMPORT_FORMAT_VERSION } from '../source-state.js';

const metadata = { resource_id:'official-resource',source_url:'https://ckan0.cf.opendata.inter.prod-toronto.ca/snapshot.json',
  source_last_modified:'2026-10-20T20:53:51',source_size:220000000,source_hash:'' };
const checkpoint = { revision:sourceRevision(metadata),format_version:IMPORT_FORMAT_VERSION,
  provenance:{sha256:'a'.repeat(64),bytes:220000000} };
test('only a verified compatible import can skip an identical official publication',()=>{
  assert.equal(canSkipDownload(checkpoint,{...metadata}),true);
  assert.equal(canSkipDownload(null,metadata),false);
  assert.equal(canSkipDownload({...checkpoint,format_version:0},metadata),false);
  assert.equal(canSkipDownload({...checkpoint,provenance:{}},metadata),false);
  for(const field of ['resource_id','source_url','source_last_modified','source_size','source_hash']) {
    assert.equal(canSkipDownload(checkpoint,{...metadata,[field]:`${metadata[field]}-changed`}),false,field);
  }
});
test('missing revision information never creates a checkpoint',()=>{
  assert.equal(sourceRevision({}),null);
});
