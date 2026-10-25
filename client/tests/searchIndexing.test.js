import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import React from 'react';
import {MemoryRouter} from 'react-router-dom';
import {renderToStaticMarkup} from 'react-dom/server';

test('route metadata belongs in the document head and only the plain app homepage is indexable',()=>{
  const built=buildSync({entryPoints:[fileURLToPath(new URL('../src/components/SearchIndexing.jsx',import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/*','react-router-dom']});
  const module={exports:{}};
  vm.runInNewContext(built.outputFiles[0].text,{require:createRequire(import.meta.url),module,exports:module.exports});
  const Metadata=module.exports.default;
  for(const path of ['/','/events/391','/?event=391','/?category=Other&event=391','/?ev%65nt=391','/events/new','/signin','/bookmarks','/settings']){
    const html=renderToStaticMarkup(React.createElement(MemoryRouter,{initialEntries:[path]},
      React.createElement('main',null,React.createElement(Metadata),'App content')));
    const directive=path==='/'?'index, follow':'noindex, follow';
    assert.ok(html.startsWith(`<meta name="robots" content="${directive}"/>`),path);
    assert.ok(html.endsWith('<main>App content</main>'),path);
  }
});
