export function installArtistPicker({ artists, initialArtist, onSelect }) {
 const root=document.getElementById('intro'),list=document.getElementById('artist-list');
 const title=document.getElementById('flow-name');
 const primary=document.getElementById('picker-enter');
 const controller=new window.AbortController();
 const listen=(element,event,handler,options={})=>element.addEventListener(event,handler,{...options,signal:controller.signal});
 const motion=window.matchMedia('(prefers-reduced-motion: reduce)');
 const collection=[...artists];
 let position=0,target=0,frame=null,settle=null,lastIndex=-1,choosing=false,drag=null,ignoreClick=false;
 const wrap=index=>(index%collection.length+collection.length)%collection.length;
 const delta=value=>{value=(value%collection.length+collection.length)%collection.length;return value>collection.length/2?value-collection.length:value;};
 const visible=()=>!root.inert&&!root.closest('[inert]')&&root.style.display!=='none'&&!root.classList.contains('out');
 const safeImage=value=>{try{const u=new URL(value);return u.protocol==='https:'?u.href:'';}catch{return '';}};
 function addArtist(artist){
  const button=document.createElement('button');button.type='button';button.className='artist-item';
  button.setAttribute('aria-label','Choose '+artist.name);button.dataset.artistId=String(artist.id);
  const portrait=document.createElement('span');portrait.className='artist-avatar';
  const initials=document.createElement('span');initials.className='artist-initials';initials.textContent=artist.name.split(/\s+/).map(word=>word[0]).slice(0,2).join('');portrait.append(initials);
  const url=safeImage(artist.avatar);
  if(url){const img=document.createElement('img');img.src=url;img.alt='';img.draggable=false;img.decoding='async';img.addEventListener('error',()=>img.remove(),{once:true});portrait.append(img);}
  button.append(portrait);list.append(button);
  listen(button,'click',()=>{
   if(ignoreClick){ignoreClick=false;return;}
   const index=collection.findIndex(a=>String(a.id)===String(artist.id));
   if(index===wrap(Math.round(target)))choose();else moveTo(target+delta(index-target));
  });
 }
 collection.forEach(addArtist);
 function render(){
  const mobile=window.innerWidth<768,short=window.innerHeight<700;
  const width=mobile?(short?154:190):Math.min(260,Math.max(200,window.innerWidth*.185));
  const height=width*1.16,spacing=mobile?width*.94:width+30;
  root.style.setProperty('--portrait-width',width+'px');root.style.setProperty('--portrait-height',height+'px');
  const active=wrap(Math.round(position));
  [...list.children].forEach((item,index)=>{
   const distance=delta(index-position),abs=Math.abs(distance),near=abs<3.3;
   item.style.visibility=near?'visible':'hidden';item.style.pointerEvents=near?'auto':'none';
   item.style.transform=`translate3d(${distance*spacing}px,${Math.min(abs,3)*15}px,${-Math.min(abs,3)*90}px) rotateY(${-Math.max(-2,Math.min(2,distance))*17}deg) scale(${1-Math.min(abs,3)*.105})`;
   item.style.opacity=near?String(Math.max(.12,1-abs*.23)):'0';item.style.zIndex=String(Math.round(100-abs*10));
   item.classList.toggle('cur',index===active);item.tabIndex=index===active?0:-1;item.setAttribute('aria-pressed',String(index===active));item.setAttribute('aria-hidden',String(!near));
  });
  if(active!==lastIndex){
   lastIndex=active;title.textContent=collection[active].name;
   primary.setAttribute('aria-label','Explore records by '+collection[active].name);
  }
 }
 function animate(){
  frame=null;if(!visible())return;
  if(motion.matches||Math.abs(target-position)<.002)position=target;
  else{position+=(target-position)*.16;frame=requestAnimationFrame(animate);}
  render();
 }
 function moveTo(value){target=value;if(!frame)frame=requestAnimationFrame(animate);}
 async function choose(){
  if(choosing||!collection.length)return;
  choosing=true;primary.disabled=true;primary.setAttribute('aria-busy','true');
  try{await onSelect(collection[wrap(Math.round(target))]);}
  finally{choosing=false;primary.disabled=false;primary.removeAttribute('aria-busy');}
 }
 function focusArtist(artist){
  if(artist?.id&&!collection.some(a=>String(a.id)===String(artist.id))){collection.push(artist);addArtist(artist);}
  let index=collection.findIndex(a=>String(a.id)===String(artist?.id));
  if(index<0)index=Math.max(0,collection.findIndex(a=>a.name==='Frank Ocean'));
  position=target=index;lastIndex=-1;render();
 }
 listen(primary,'click',choose);
 listen(document.getElementById('picker-prev'),'click',()=>moveTo(Math.round(target)-1));
 listen(document.getElementById('picker-next'),'click',()=>moveTo(Math.round(target)+1));
 listen(root,'wheel',event=>{
  if(event.ctrlKey||!visible())return;event.preventDefault();
  const scale=event.deltaMode===1?16:event.deltaMode===2?window.innerHeight:1;
  const amount=(Math.abs(event.deltaX)>Math.abs(event.deltaY)?event.deltaX:event.deltaY)*scale;
  moveTo(target+Math.max(-.75,Math.min(.75,amount/330)));
  clearTimeout(settle);settle=setTimeout(()=>moveTo(Math.round(target)),160);
 },{passive:false});
 listen(list,'pointerdown',event=>{
  if(event.pointerType==='mouse')return;
  drag={x:event.clientX,y:event.clientY,position:target};ignoreClick=false;
 });
 listen(list,'pointermove',event=>{
  if(!drag)return;const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
  if(Math.abs(dx)>12&&Math.abs(dx)>Math.abs(dy)){
   ignoreClick=true;const spacing=window.innerWidth<768?190*.94:Math.min(260,Math.max(200,window.innerWidth*.185))+30;
   moveTo(drag.position-dx/spacing);
  }
 });
 const endDrag=()=>{if(drag){drag=null;moveTo(Math.round(target));setTimeout(()=>ignoreClick=false,0);}};
 listen(list,'pointerup',endDrag);listen(list,'pointercancel',endDrag);listen(list,'pointerleave',endDrag);
 listen(document,'keydown',event=>{
  if(!visible()||document.querySelector('dialog[open]')||event.target.matches?.('input,textarea,select'))return;
  if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(event.key)){
   event.preventDefault();moveTo(Math.round(target)+(['ArrowRight','ArrowDown'].includes(event.key)?1:-1));
  }else if(event.key==='Enter'&&!event.target.closest?.('button')){event.preventDefault();choose();}
 });
 listen(window,'resize',render);
 focusArtist(initialArtist);
 return {focusArtist,destroy:()=>{controller.abort();clearTimeout(settle);if(frame)cancelAnimationFrame(frame);}};
}
