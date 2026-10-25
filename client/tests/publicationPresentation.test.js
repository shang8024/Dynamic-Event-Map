import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSync} from 'esbuild';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import React from 'react';
import {MemoryRouter} from 'react-router-dom';
import {renderToStaticMarkup} from 'react-dom/server';
function component(name) {
  const built=buildSync({entryPoints:[fileURLToPath(new URL(`../src/components/${name}.jsx`,import.meta.url))],bundle:true,write:false,platform:'node',format:'cjs',jsx:'automatic',external:['react','react/*','react-router-dom']});
  const module={exports:{}};
  vm.runInNewContext(built.outputFiles[0].text,{require:createRequire(import.meta.url),module,exports:module.exports});
  return module.exports.default;
}
test('publication pills distinguish private pending/rejected submissions from published events',()=>{
  const Status=component('PublicationStatus');
  for(const [status,label] of [['pending','Under review'],['rejected','Rejected'],['approved','Published'],['published','Published']]) {
    const html=renderToStaticMarkup(React.createElement(Status,{status}));
    assert.ok(html.includes(`publication-${status}`));assert.ok(html.includes('role="status"'));assert.ok(html.includes(`>${label}</span>`));
  }
});
test('rejection reasons are literal text and cannot inject HTML into the private preview',()=>{
  const Feedback=component('PublicationFeedback');
  const html=renderToStaticMarkup(React.createElement(Feedback,{note:'<script>alert(1)</script>\n<img src=x onerror=alert(1)>'}));
  assert.match(html,/Reason for rejection/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<script|<img/);
});
test('account pages keep a common outer layout and use route-specific section labels',()=>{
  const Layout=component('PageLayout');
  for(const [route,label,narrow] of [['/bookmarks','Your saved plans',false],['/recommendations','Picked for you',false],
    ['/comments','Your conversations',false],['/notifications','Updates &amp; activity',true],['/settings','Your preferences',true],['/my-events','Your events',false]]) {
    const html=renderToStaticMarkup(React.createElement(MemoryRouter,{initialEntries:[route]},React.createElement(Layout,{title:'Test page',narrow},'Content')));
    assert.match(html,/class="personal-page/);assert.ok(html.includes(label),route);assert.ok(html.includes('href="/my-events"'));assert.ok(!html.includes('Your space'));
  }
});
