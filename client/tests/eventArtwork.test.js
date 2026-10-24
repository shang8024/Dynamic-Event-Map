import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

test('missing and pending event photos render safely; decorative list artwork has no duplicate accessible label',()=>{
  const built=buildSync({entryPoints:[new URL('../src/components/EventArtwork.jsx',import.meta.url).pathname.replace(/^\/(\w:)/,'$1')],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/*']});
  const module={exports:{}};
  vm.runInNewContext(built.outputFiles[0].text,{require:createRequire(import.meta.url),module,exports:module.exports,URL,AbortController,fetch,setTimeout,clearTimeout});
  const Artwork=module.exports.default;
  const missing=renderToStaticMarkup(React.createElement(Artwork,{title:'No photo',category:'Other'}));
  assert.match(missing,/event-template/);assert.doesNotMatch(missing,/<img/);
  const decorative=renderToStaticMarkup(React.createElement(Artwork,{title:'List event',alt:'',src:'/api/events/1/image?size=thumb'}));
  assert.doesNotMatch(decorative,/role="img"|aria-label=/);assert.match(decorative,/aria-hidden="true"/);
});
