const DEFAULT_COLORS=['#496572','#875b72','#647d72','#756184','#a17b61'];
const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
const rgb=hex=>hex.match(/[a-f\d]{2}/gi).map(value=>parseInt(value,16));
const hex=values=>'#'+values.map(value=>Math.round(clamp(value,0,255)).toString(16).padStart(2,'0')).join('');

// Use distinct colours from the artwork, rather than the average grey of the entire cover.
export function paletteFromPixels(pixels){
 const buckets=new Map();
 for(let i=0;i<pixels.length;i+=4){
  if(pixels[i+3]<128)continue;
  const values=[pixels[i],pixels[i+1],pixels[i+2]],key=values.map(value=>Math.floor(value/32)).join(',');
  const bucket=buckets.get(key)||{sum:[0,0,0],count:0};
  values.forEach((value,index)=>bucket.sum[index]+=value);bucket.count++;buckets.set(key,bucket);
 }
 const candidates=[...buckets.values()].map(bucket=>{
  const color=bucket.sum.map(value=>value/bucket.count),max=Math.max(...color),min=Math.min(...color);
  return {color,score:Math.sqrt(bucket.count)*(.35+(max-min)/255)*(max>24&&min<232?1:.12)};
 }).sort((a,b)=>b.score-a.score);
 const chosen=[];
 for(const {color}of candidates){
  if(chosen.every(other=>Math.hypot(...color.map((value,index)=>value-other[index]))>55))chosen.push(color);
  if(chosen.length===5)break;
 }
 if(!chosen.length)return [...DEFAULT_COLORS];
 const base=chosen[0];
 while(chosen.length<5){const shift=[-26,22,-12,35][chosen.length-1]||0;chosen.push(base.map(value=>clamp(value+shift,18,230)));}
 return chosen.map(hex);
}
export function paletteFromImage(image){
 try{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=48;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(image,0,0,48,48);
  return paletteFromPixels(context.getImageData(0,0,48,48).data);
 }catch{return [...DEFAULT_COLORS];}
}
function preparePalette(colors){
 const valid=(colors||[]).filter(color=>/^#[a-f\d]{6}$/i.test(color));
 const complete=valid.length?[...valid]:[...DEFAULT_COLORS];
 while(complete.length<5){const shifts=[-26,24,-12,38],base=rgb(complete[0]),shift=shifts[complete.length-1]||0;complete.push(hex(base.map((value,index)=>value+shift+(index===complete.length%3?12:0))));}
 return complete.slice(0,5).map(color=>{
  const values=rgb(color),light=values[0]*.2126+values[1]*.7152+values[2]*.0722;
  const scale=light>130?130/light:1;
  return values.map(value=>Math.max(16,value*scale));
 });
}

// Overlapping, drifting ellipses create a continuous colour field; no repeating video or audio analysis.
export function drawAmbientField(context,colors,time,width,height){
 context.globalCompositeOperation='source-over';context.globalAlpha=1;
 context.fillStyle=`rgb(${colors[0].map(Math.round).join(',')})`;context.fillRect(0,0,width,height);
 const span=Math.max(width,height);
 for(let i=0;i<7;i++){
  const phase=i*2.39996;
  const x=width*(.5+.46*Math.sin(time*.23+phase)+.12*Math.cos(time*.37-phase));
  const y=height*(.5+.44*Math.cos(time*.19+phase)+.12*Math.sin(time*.31+phase));
  const radius=span*(.43+.07*Math.sin(time*.13+phase));
  const color=colors[(i+1)%colors.length].map(Math.round).join(',');
  context.save();context.translate(x,y);context.rotate(Math.sin(time*.11+phase)*1.2);context.scale(1.5,.86);
  const gradient=context.createRadialGradient(0,0,0,0,0,radius);
  gradient.addColorStop(0,`rgba(${color},.95)`);gradient.addColorStop(.42,`rgba(${color},.65)`);gradient.addColorStop(1,`rgba(${color},0)`);
  context.fillStyle=gradient;context.fillRect(-radius,-radius,radius*2,radius*2);context.restore();
 }
}

export function createAmbientBackground({root,audio}){
 const doc=root.ownerDocument,view=doc.defaultView,controller=new view.AbortController();
 const layer=doc.createElement('div');layer.className='lyr-ambient';layer.setAttribute('aria-hidden','true');
 const canvas=doc.createElement('canvas');layer.append(canvas);root.prepend(layer);
 const context=canvas.getContext('2d',{alpha:false});
 if(!context)return {setPalette:()=>{},setVisible:()=>{},destroy:()=>layer.remove()};
 const reduced=view.matchMedia('(prefers-reduced-motion: reduce)');
 let colors=preparePalette(DEFAULT_COLORS),target=colors.map(color=>[...color]),visible=false,frame=null,last=null,elapsed=0;
 const listen=(element,event,handler)=>element.addEventListener(event,handler,{signal:controller.signal});
 const shouldFlow=()=>visible&&!audio.paused&&!audio.ended&&!doc.hidden&&!reduced.matches;
 function paint(){drawAmbientField(context,colors,elapsed,canvas.width,canvas.height);}
 function resize(){
  const width=root.clientWidth||view.innerWidth,height=root.clientHeight||view.innerHeight;
  const scale=Math.min(1,480/Math.max(width,height));
  canvas.width=Math.max(96,Math.round(width*scale));canvas.height=Math.max(96,Math.round(height*scale));paint();
 }
 function tick(timestamp){
  frame=null;if(!shouldFlow())return;
  if(last===null)last=timestamp;
  const dt=timestamp-last;
  if(dt>=1000/24){
   const seconds=Math.min(dt,100)/1000;elapsed+=seconds;last=timestamp;
   const blend=1-Math.exp(-seconds*2.2);
   colors=colors.map((color,i)=>color.map((value,j)=>value+(target[i][j]-value)*blend));paint();
  }
  frame=view.requestAnimationFrame(tick);
 }
 function sync(){
  const active=shouldFlow();layer.dataset.state=active?'flowing':'still';
  if(active&&frame===null){last=null;frame=view.requestAnimationFrame(tick);}
  if(!active&&frame!==null){view.cancelAnimationFrame(frame);frame=null;last=null;}
 }
 listen(audio,'play',sync);listen(audio,'pause',sync);listen(audio,'ended',sync);
 listen(doc,'visibilitychange',sync);listen(view,'resize',resize);listen(reduced,'change',sync);
 resize();sync();
 return {
  setPalette(palette){target=preparePalette(palette);if(!shouldFlow()){colors=target.map(color=>[...color]);paint();}},
  setVisible(value){visible=Boolean(value);if(visible)paint();sync();},
  destroy(){controller.abort();if(frame!==null)view.cancelAnimationFrame(frame);layer.remove();}
 };
}
