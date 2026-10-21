import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {ApiError,clientError} from '../src/services/apiErrors.js';
import {mutateBookmark} from '../src/services/bookmarkOperations.js';

// Execute the real hook's mutation flow with isolated React state/identity seams.
// No DOM, Firebase account, real request or implementation-shaped SQL stub needed.
function hook({marked=false,...adapters}={}) {
  const states=[],refs=[],notices=[];let stateIndex=0;
  const source=fs.readFileSync(new URL('../src/hooks/useBookmarks.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replace('export function useBookmarks','function useBookmarks');
  const context={Set,Symbol,Date,ApiError,clientError,mutateBookmark,
    useAuth:()=>({user:{uid:'current-user'}}),useNotifications:()=>({push:value=>notices.push(value)}),
    useState(initial){const index=stateIndex++;states[index]=index===0?new Set(marked?[1]:[]):typeof initial==='function'?initial():initial;
      return [states[index],value=>{states[index]=typeof value==='function'?value(states[index]):value;}];},
    useRef(value){const ref={current:value};refs.push(ref);return ref;},useEffect(){},useCallback:callback=>callback,useMemo:factory=>factory(),
    addBookmark:async()=>({id:12}),removeBookmark:async()=>({}),fetchBookmarks:async()=>({items:[]}),
    ...adapters,
  };
  vm.runInNewContext(source+'\nthis.hookResult=useBookmarks();',context);
  return {api:context.hookResult,states,refs,notices};
}
test('a successful write remains saved even when statistics are unavailable',async()=>{
  const fixture=hook({fetchBookmarkStats(){throw new Error('stats offline');}});
  const result=await fixture.api.toggle(1,true,{id:1,title:'Test event'});
  assert.equal(result.ok,true);assert.equal(fixture.states[0].has(1),true);
  assert.equal(fixture.states[1][0].data.id,1);assert.equal(fixture.states[2].size,0);
  assert.equal(fixture.notices.at(-1).type,'success');
});
test('failed removal is not silently interpreted as already absent',async()=>{
  const fixture=hook({marked:true,removeBookmark:async()=>{throw new ApiError('You do not have permission.',{status:403});}});
  const result=await fixture.api.toggle(1,false);
  assert.equal(result.ok,false);assert.equal(result.error.status,403);assert.equal(fixture.states[0].has(1),true);
  assert.equal(fixture.notices.at(-1).type,'error');
});
test('an unconfirmed mutation retains last confirmed state and requires a status check',async()=>{
  const fixture=hook({marked:true,removeBookmark:async()=>{throw new ApiError('unknown',{ambiguous:true});},fetchBookmarks:async()=>{throw new Error('offline');}});
  const result=await fixture.api.toggle(1,false);
  assert.equal(result.ambiguous,true);assert.equal(fixture.states[0].has(1),true);assert.equal(fixture.states[3].has(1),true);
  assert.equal(fixture.notices.at(-1).action.label,'Check saved events');
});
test('in-flight old-account writes never publish state or success messages into another account',async()=>{
  let finish;const fixture=hook({addBookmark:()=>new Promise(resolve=>{finish=resolve;})});
  const pending=fixture.api.toggle(1,true,{id:1,title:'Old account event'});
  fixture.refs[0].current='different-user';finish({id:12});await pending;
  assert.equal(fixture.notices.length,0);assert.equal(fixture.states[1].length,0);
});
