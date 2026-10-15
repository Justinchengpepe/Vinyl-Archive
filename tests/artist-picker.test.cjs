const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const markup=html.slice(html.indexOf('<section id="intro"'),html.indexOf('\n<div id="c">'));
const code=fs.readFileSync(path.join(__dirname,'../js/artist-picker.js'),'utf8');
const modulePromise=import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const artists=[{id:'1',name:'First Artist'},{id:'2',name:'Second Artist'},{id:'3',name:'Third Artist'},{id:'4',name:'Fourth Artist'},{id:'5',name:'Fifth Artist'}];
const flush=()=>new Promise(resolve=>setTimeout(resolve,8));
async function setup(t,options={}){
 const dom=new JSDOM(markup);global.document=dom.window.document;global.window=dom.window;
 dom.window.matchMedia=()=>({matches:true});
 global.requestAnimationFrame=handler=>setTimeout(handler,0);global.cancelAnimationFrame=clearTimeout;
 const selected=[];let searches=0;
 const {installArtistPicker}=await modulePromise;
 const ui=installArtistPicker({artists,onSelect:async artist=>selected.push(artist.id),onSearch:()=>++searches,...options});
 const find=selector=>dom.window.document.querySelector(selector);
 const key=value=>dom.window.document.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:value,bubbles:true,cancelable:true}));
 t.after(()=>{ui.destroy();dom.window.close();delete global.document;delete global.window;delete global.requestAnimationFrame;delete global.cancelAnimationFrame;});
 return {...ui,find,key,selected,searches:()=>searches,dom};
}
test('opening the picker highlights the remembered artist without selecting automatically',async t=>{
 const ui=await setup(t,{initialArtist:artists[2]});
 assert.equal(ui.find('#flow-name').textContent,'Third Artist');assert.deepEqual(ui.selected,[]);
 assert.equal(ui.find('.artist-item.cur').dataset.artistId,'3');
 assert.equal(ui.find('.artist-item.cur').getAttribute('aria-pressed'),'true');
 ui.find('#picker-enter').click();await flush();assert.deepEqual(ui.selected,['3']);
});
test('next and previous controls wrap around the collection',async t=>{
 const ui=await setup(t,{initialArtist:artists[4]});
 ui.find('#picker-next').click();await flush();assert.equal(ui.find('#flow-name').textContent,'First Artist');
 ui.find('#picker-prev').click();await flush();assert.equal(ui.find('#flow-name').textContent,'Fifth Artist');
});
test('arrow keys browse and Enter opens the highlighted artist',async t=>{
 const ui=await setup(t,{initialArtist:artists[0]});
 ui.key('ArrowRight');await flush();ui.key('Enter');await flush();assert.deepEqual(ui.selected,['2']);
});
test('clicking a side portrait previews it before entering its record room',async t=>{
 const ui=await setup(t,{initialArtist:artists[0]});
 ui.find('[data-artist-id="2"]').click();await flush();assert.equal(ui.find('#flow-name').textContent,'Second Artist');assert.deepEqual(ui.selected,[]);
 ui.find('[data-artist-id="2"]').click();await flush();assert.deepEqual(ui.selected,['2']);
});
test('a large wheel movement advances at most one artist',async t=>{
 const ui=await setup(t,{initialArtist:artists[0]});
 ui.find('#intro').dispatchEvent(new ui.dom.window.WheelEvent('wheel',{deltaY:1200,cancelable:true}));await flush();
 assert.equal(ui.find('#flow-name').textContent,'Second Artist');
});
test('modal dialogs and hidden pickers do not receive browsing keys',async t=>{
 const ui=await setup(t,{initialArtist:artists[0]});
 const dialog=ui.dom.window.document.createElement('dialog');dialog.setAttribute('open','');ui.dom.window.document.body.append(dialog);
 ui.key('ArrowRight');await flush();assert.equal(ui.find('#flow-name').textContent,'First Artist');
 dialog.remove();ui.find('#intro').inert=true;ui.key('ArrowRight');await flush();assert.equal(ui.find('#flow-name').textContent,'First Artist');
});
test('returning from a searched artist keeps that artist available in the picker',async t=>{
 const ui=await setup(t);ui.focusArtist({id:'8',name:'Searched Artist'});
 assert.equal(ui.find('#flow-name').textContent,'Searched Artist');assert.equal(ui.find('.artist-item.cur').dataset.artistId,'8');
 ui.focusArtist({id:'8',name:'Searched Artist'});assert.equal(ui.dom.window.document.querySelectorAll('.artist-item').length,6);
});
test('an unsuccessful entry can be retried without a disabled primary button',async t=>{
 let attempts=0;const ui=await setup(t,{onSelect:async()=>{attempts++;return false;}});
 ui.find('#picker-enter').click();await flush();assert.equal(ui.find('#picker-enter').disabled,false);
 ui.find('#picker-enter').click();await flush();assert.equal(attempts,2);
});
