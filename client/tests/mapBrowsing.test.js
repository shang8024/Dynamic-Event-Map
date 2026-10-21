import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberMapBrowsing,readMapBrowsing} from '../src/services/mapBrowsing.js';

test('Back restores its own list and viewport rather than the last detail view',()=>{
  const list={center:{lat:43.65,lng:-79.4},zoom:14,listOpen:true,clusterIds:[2,3],scrollTop:480,focusId:3};
  rememberMapBrowsing('list',list);
  rememberMapBrowsing('detail',{...list,zoom:16,listOpen:false,clusterIds:[],scrollTop:0});
  assert.deepEqual(readMapBrowsing('list'),list);
  const restored=readMapBrowsing('list');restored.clusterIds.push(99);restored.center.lat=0;
  assert.deepEqual(readMapBrowsing('list'),list);
  assert.equal(readMapBrowsing('unvisited',{fallback:false}),null);
  assert.equal(readMapBrowsing('return-from-account').zoom,16);
});
