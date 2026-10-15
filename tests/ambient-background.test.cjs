const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../js/ambient-background.js'),'utf8');
const api=import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
function drawingContext(){
 const operations=[];
 return {operations,fillStyle:'',globalAlpha:1,globalCompositeOperation:'',fillRect(...args){operations.push(['fill',typeof this.fillStyle==='string'?this.fillStyle:'gradient',...args]);},save(){},restore(){},translate(...args){operations.push(['translate',...args]);},rotate(){},scale(){},createRadialGradient(){return {addColorStop(){}};}};
}
test('cover palette keeps distinct artwork colours and ignores transparent pixels',async()=>{
 const {paletteFromPixels}=await api;
 const pixels=new Uint8ClampedArray([230,35,35,255,220,30,40,255,30,70,220,255,35,75,230,255,0,255,0,0]);
 const colors=paletteFromPixels(pixels);
 assert.equal(colors.length,5);assert.ok(colors.every(color=>/^#[\da-f]{6}$/.test(color)));
 assert.ok(colors.some(color=>parseInt(color.slice(1,3),16)>180));
 assert.ok(colors.some(color=>parseInt(color.slice(5,7),16)>180));
 assert.equal(colors.includes('#00ff00'),false);
});
test('missing or monochrome artwork still has a complete finite palette',async()=>{
 const {paletteFromPixels}=await api;
 for(const pixels of [[],[0,0,0,255],[255,255,255,255]]){
  const result=paletteFromPixels(pixels);assert.equal(result.length,5);assert.ok(result.every(color=>/^#[\da-f]{6}$/.test(color)));
 }
});
test('the colour field changes with time and holds the same composition for a fixed time',async()=>{
 const {drawAmbientField}=await api,colors=[[30,80,120],[130,30,80],[10,120,80],[110,60,130],[120,80,30]];
 const a=drawingContext(),b=drawingContext(),c=drawingContext();
 drawAmbientField(a,colors,0,320,200);drawAmbientField(b,colors,5,320,200);drawAmbientField(c,colors,0,320,200);
 assert.notDeepEqual(a.operations,b.operations);assert.deepEqual(a.operations,c.operations);
});
async function setup(t,{reduced=false}={}){
 const dom=new JSDOM('<div id="scene"></div><audio></audio>');
 const context=drawingContext();dom.window.HTMLCanvasElement.prototype.getContext=()=>context;
 const preference=new dom.window.EventTarget();preference.matches=reduced;dom.window.matchMedia=()=>preference;
 const frames=new Map();let serial=0;
 dom.window.requestAnimationFrame=handler=>{frames.set(++serial,handler);return serial;};
 dom.window.cancelAnimationFrame=id=>frames.delete(id);
 let paused=true,hidden=false;
 const audio=dom.window.document.querySelector('audio'),root=dom.window.document.getElementById('scene');
 Object.defineProperty(audio,'paused',{get:()=>paused});Object.defineProperty(dom.window.document,'hidden',{get:()=>hidden,configurable:true});
 const {createAmbientBackground}=await api;const ambient=createAmbientBackground({root,audio});
 const event=name=>audio.dispatchEvent(new dom.window.Event(name));
 t.after(()=>{ambient.destroy();dom.window.close();});
 return {ambient,frames,context,root,preference,dom,
  play(){paused=false;event('play');},pause(){paused=true;event('pause');},
  hide(value){hidden=value;dom.window.document.dispatchEvent(new dom.window.Event('visibilitychange'));},
  step(time){const active=[...frames.values()];frames.clear();active.forEach(handler=>handler(time));}
 };
}
test('animation runs only while music plays in the visible playback scene',async t=>{
 const ui=await setup(t);ui.play();assert.equal(ui.frames.size,0);
 ui.ambient.setVisible(true);assert.equal(ui.frames.size,1);
 ui.step(0);const before=ui.context.operations.length;ui.step(50);assert.ok(ui.context.operations.length>before);
 ui.pause();assert.equal(ui.frames.size,0);assert.equal(ui.root.firstElementChild.dataset.state,'still');
 ui.play();assert.equal(ui.frames.size,1);ui.ambient.setVisible(false);assert.equal(ui.frames.size,0);
});
test('background work stops when the document is hidden and resumes when visible',async t=>{
 const ui=await setup(t);ui.ambient.setVisible(true);ui.play();ui.hide(true);assert.equal(ui.frames.size,0);
 ui.hide(false);assert.equal(ui.frames.size,1);
});
test('reduced motion displays the artwork colours without a running animation',async t=>{
 const ui=await setup(t,{reduced:true});ui.ambient.setVisible(true);ui.play();assert.equal(ui.frames.size,0);
 ui.ambient.setPalette(['#ff0000','#0000ff']);assert.equal(ui.frames.size,0);
 assert.equal(ui.root.firstElementChild.dataset.state,'still');
});
test('colour changes do not create multiple animation loops and the canvas stays bounded',async t=>{
 const ui=await setup(t);ui.ambient.setVisible(true);ui.play();
 ui.ambient.setPalette(['#ff0000']);ui.ambient.setPalette(['#0000ff']);assert.equal(ui.frames.size,1);
 const canvas=ui.root.querySelector('canvas');assert.ok(Math.max(canvas.width,canvas.height)<=480);
 ui.ambient.destroy();assert.equal(ui.frames.size,0);assert.equal(ui.root.children.length,0);
});
