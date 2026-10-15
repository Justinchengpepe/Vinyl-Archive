const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync(require('node:path').join(__dirname,'../js/archive-search.js'),'utf8');
const modulePromise = import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const tick = () => new Promise(resolve=>setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(r=>resolve=r); return {promise,resolve}; };
const response = {result:{artists:[{id:1,name:'First Artist'},{id:2,name:'Second Artist'}],artistCount:2,albums:[{id:10,name:'First Album'},{id:20,name:'Second Album'}],albumCount:2}};
async function setup(t, overrides={}){
 const dom=new JSDOM('<button id="archive-search-button">Search</button>');
 global.document=dom.window.document;
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 dom.window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new dom.window.Event('close'));};
 const {installArchiveSearch}=await modulePromise;
 const ui=installArchiveSearch({api:async()=>response,onArtist:async()=>true,onAlbum:async()=>{},...overrides});
 const find=selector=>dom.window.document.querySelector(selector);
 const search=async()=>{find('input').value='Artist';find('form').dispatchEvent(new dom.window.Event('submit',{cancelable:true,bubbles:true}));await tick();};
 t.after(()=>{dom.window.close();delete global.document;});
 return {...ui,find,search};
}
test('a selected result remains selectable when search is reopened',async t=>{
 const chosen=[];const ui=await setup(t,{onArtist:async artist=>{chosen.push(artist.id);return true;}});
 ui.open();await ui.search();const first=ui.find('[data-id="1"]');
 first.click();await tick();assert.equal(ui.dialog.open,false);assert.equal(first.disabled,false);
 ui.open();first.click();await tick();assert.deepEqual(chosen,['1','1']);assert.equal(ui.dialog.open,false);
});
test('users can alternate between results without disabling earlier choices',async t=>{
 const chosen=[];const ui=await setup(t,{onArtist:async artist=>chosen.push(artist.id)});
 ui.open();await ui.search();
 for(const id of ['1','2','1']){ui.open();ui.find(`[data-id="${id}"]`).click();await tick();}
 assert.deepEqual(chosen,['1','2','1']);
});
test('failed artist selection stays open and can be retried',async t=>{
 let attempts=0;const ui=await setup(t,{onArtist:async()=>++attempts>1});
 ui.open();await ui.search();const first=ui.find('[data-id="1"]');
 first.click();await tick();assert.equal(ui.dialog.open,true);assert.equal(first.disabled,false);assert.ok(ui.find('[data-selection-error]'));
 first.click();await tick();assert.equal(attempts,2);assert.equal(ui.dialog.open,false);assert.equal(ui.find('[data-selection-error]'),null);
});
test('album results can be reopened and selected repeatedly',async t=>{
 const chosen=[];const ui=await setup(t,{onAlbum:async id=>chosen.push(id)});
 ui.open();ui.find('input').value='Album';ui.find('[data-type="10"]').click();await tick();
 const album=ui.find('[data-id="10"]');album.click();await tick();ui.open();album.click();await tick();
 assert.deepEqual(chosen,['10','10']);
});
test('completion from a closed dialog cannot close a newly opened search',async t=>{
 const pending=deferred();let attempts=0;
 const ui=await setup(t,{onArtist:async()=>{if(++attempts===1)await pending.promise;return true;}});
 ui.open();await ui.search();ui.find('[data-id="1"]').click();
 ui.dialog.close();ui.open();pending.resolve();await tick();
 assert.equal(ui.dialog.open,true);assert.equal(ui.find('[data-id="1"]').disabled,false);
 ui.find('[data-id="2"]').click();await tick();assert.equal(ui.dialog.open,false);
});
test('closing an unfinished search does not leave loading or pagination stuck',async t=>{
 const pending=deferred();let calls=0;
 const ui=await setup(t,{api:async()=>{if(++calls===1)return pending.promise;return response;}});
 ui.open();await ui.search();ui.dialog.close();ui.open();await tick();
 assert.equal(calls,2);assert.ok(ui.find('[data-id="1"]'));
 pending.resolve({result:{artists:[],artistCount:0}});await tick();
 assert.ok(ui.find('[data-id="1"]'));assert.equal(ui.dialog.open,true);
});
test('starting a new search prevents an earlier selection from dismissing its results',async t=>{
 const pending=deferred();const ui=await setup(t,{onArtist:async()=>{await pending.promise;return true;}});
 ui.open();await ui.search();ui.find('[data-id="1"]').click();await ui.search();
 pending.resolve();await tick();assert.equal(ui.dialog.open,true);assert.ok(ui.find('[data-id="2"]'));
});
