import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import React from 'react';
import {MemoryRouter} from 'react-router-dom';
import {renderToStaticMarkup} from 'react-dom/server';

async function gate(user) {
  const built=await build({entryPoints:[fileURLToPath(new URL('../src/components/ReviewAccessGate.jsx',import.meta.url))],
    bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/*','react-router-dom'],
    plugins:[{name:'fixture-identity',setup(build){build.onLoad({filter:/[\\/]contexts[\\/]AuthContext\.jsx$/},()=>({contents:
      `export const useAuth=()=>({user:${JSON.stringify(user)}});`,loader:'js'}));}}]});
  const module={exports:{}};
  vm.runInNewContext(built.outputFiles[0].text,{require:createRequire(import.meta.url),module,exports:module.exports});
  return module.exports.default;
}

test('direct review URLs do not mount queues or fetch their data for non-administrators',async()=>{
  for(const user of [null,{id:1,role:'member'},{id:1,role:'Admin'},{id:1}]) for(const path of ['/my-events?review=true','/contributions?review=true']) {
    let mounted=false;
    function PrivateQueue(){mounted=true;return React.createElement('p',null,'Private draft');}
    const html=renderToStaticMarkup(React.createElement(MemoryRouter,{initialEntries:[path]},
      React.createElement(await gate(user),null,React.createElement(PrivateQueue))));
    assert.equal(mounted,false);assert.match(html,/Administrator access required/);assert.match(html,/Go to my dashboard/);assert.doesNotMatch(html,/Private draft/);
  }
});

test('administrators can open queues and members retain their ordinary dashboard',async()=>{
  for(const [user,path] of [[{id:1,role:'admin'},'/my-events?review=true'],[{id:1,role:'admin'},'/contributions?review=true'],
    [{id:2,role:'member'},'/my-events'],[{id:2,role:'member'},'/contributions']]) {
    const html=renderToStaticMarkup(React.createElement(MemoryRouter,{initialEntries:[path]},
      React.createElement(await gate(user),null,React.createElement('p',null,'Allowed content'))));
    assert.match(html,/Allowed content/);assert.doesNotMatch(html,/Administrator access required/);
  }
});
