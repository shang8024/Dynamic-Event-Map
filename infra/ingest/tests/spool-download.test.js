import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import { withSpooledDownload } from '../spool-download.js';

test('download is complete and checksummed before parsing; temporary files are removed',async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'eventmap-spool-test-'));
  try {
    const payload=Buffer.from('{"value":["Toronto é"]}');
    const result=await withSpooledDownload(Readable.from([payload.subarray(0,8),payload.subarray(8)]),async(file,metadata)=>{
      assert.deepEqual(await fs.readFile(file),payload);
      assert.equal(metadata.sha256,createHash('sha256').update(payload).digest('hex'));
      assert.equal(metadata.bytes,payload.length);return 'parsed';
    },{baseDirectory:base,maxBytes:1024,expectedBytes:payload.length});
    assert.equal(result,'parsed');assert.deepEqual(await fs.readdir(base),[]);
  } finally {await fs.rmdir(base);}
});
test('truncated, oversized and interrupted downloads never reach parsing and clean partial files',async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'eventmap-spool-test-'));
  try {
    for(const options of [{maxBytes:2},{maxBytes:1024,expectedBytes:9}]) {
      await assert.rejects(()=>withSpooledDownload(Readable.from([Buffer.from('hello')]),()=>assert.fail('parsed invalid download'),{baseDirectory:base,...options}));
      assert.deepEqual(await fs.readdir(base),[]);
    }
    const interrupted=Readable.from((async function*(){yield Buffer.from('partial');throw Error('network terminated');})());
    await assert.rejects(()=>withSpooledDownload(interrupted,()=>assert.fail('parsed interrupted download'),{baseDirectory:base,maxBytes:1024}),/terminated/);
    assert.deepEqual(await fs.readdir(base),[]);
  } finally {await fs.rmdir(base);}
});
test('parsing failure still removes the downloaded snapshot',async()=>{
  const base=await fs.mkdtemp(path.join(os.tmpdir(),'eventmap-spool-test-'));
  try {
    await assert.rejects(()=>withSpooledDownload(Readable.from([Buffer.from('invalid json')]),()=>{throw Error('schema rejected');},{baseDirectory:base,maxBytes:1024}),/schema rejected/);
    assert.deepEqual(await fs.readdir(base),[]);
  } finally {await fs.rmdir(base);}
});
