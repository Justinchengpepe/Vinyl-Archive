export function installArchiveSearch({ api, onArtist, onAlbum }) {
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const dialog=document.createElement('dialog');dialog.id='archive-search';
 dialog.innerHTML=`<form id="archive-find"><label for="archive-query">Explore the collection</label><div class="archive-search-input"><input id="archive-query" placeholder="Search any artist or album…" autocomplete="off"><button type="submit">Search</button></div></form><button id="archive-search-close" aria-label="Close search">×</button><div class="archive-search-types"><button data-type="100" aria-pressed="true">Artists</button><button data-type="10" aria-pressed="false">Albums</button></div><div id="archive-results" role="status"><p class="archive-note">Beyond the collection. Find your next record.</p><div class="archive-suggestions">${['Frank Ocean','Kendrick Lamar','SZA','The Weeknd','Lana Del Rey','Billie Eilish','Adele','Radiohead'].map(name=>`<button data-term="${name}">${name}</button>`).join('')}</div></div>`;
 document.body.append(dialog);let type=100, ticket=0, offset=0, term='', loading=false, selection=0, session=0, needsSearch=false;
 const results=dialog.querySelector('#archive-results'),input=dialog.querySelector('input');
 const open=()=>{if(dialog.open)return;++session;dialog.showModal();input.focus();input.select();if(needsSearch&&input.value.trim()){needsSearch=false;search();}};
 document.getElementById('archive-search-button').onclick=open;
 document.addEventListener('keydown',event=>{if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='k'){event.preventDefault();if(!dialog.open)open();else input.focus();}});
 dialog.querySelector('#archive-search-close').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{if(dialog.open)return;++session;++selection;++ticket;needsSearch=loading;loading=false;results.querySelectorAll('button:disabled').forEach(button=>button.disabled=false);});
 async function search(more=false){
  if(loading&&more)return;term=input.value.trim();if(!term)return;const request=++ticket;++selection;const searchType=type;const keywords=term;loading=true;
  if(!more){offset=0;results.innerHTML='<p class="archive-note">Searching the catalogue…</p>';}
  try {
   const data=await api(`/api/search?keywords=${encodeURIComponent(keywords)}&type=${searchType}&offset=${offset}`);if(request!==ticket)return;
   const list=(searchType===100?data.result?.artists:data.result?.albums)||[];
   let html=list.map(item=>{const url=item.picUrl||item.img1v1Url||'';return `<button class="archive-result" data-kind="${searchType}" data-id="${item.id}" data-name="${escape(item.name)}"><span class="${searchType===10?'archive-record':'archive-face'}">${/^https?:/.test(url)?`<img src="${escape(url.replace(/^http:/,'https:'))}" alt="">`:''}</span><span><strong>${escape(item.name)}</strong><small>${escape(searchType===100?'Artist':item.artist?.name||'Album')}</small></span><span class="archive-result-arrow">↗</span></button>`;}).join('');
   if(!more)results.innerHTML=html||'<p class="archive-note">No records found. Try another name.</p>';else{results.querySelector('[data-more]')?.remove();results.insertAdjacentHTML('beforeend',html);}
   offset+=list.length;const total=searchType===100?data.result?.artistCount:data.result?.albumCount;if(list.length&&offset<total)results.insertAdjacentHTML('beforeend','<button data-more class="archive-more">Load more</button>');
  }catch{if(request===ticket)results.innerHTML='<p class="archive-note">The catalogue is temporarily unavailable. Please try again.</p>';}
  finally{if(request===ticket)loading=false;}
 }
 dialog.querySelector('form').onsubmit=event=>{event.preventDefault();search();};
 dialog.onclick=async event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.dataset.term){input.value=button.dataset.term;search();}
  if(button.dataset.type){type=Number(button.dataset.type);dialog.querySelectorAll('[data-type]').forEach(el=>el.setAttribute('aria-pressed',String(el===button)));search();}
  if(button.hasAttribute('data-more'))search(true);
  if(button.dataset.id){
   const choice=++selection, openedSession=session;
   button.disabled=true;button.setAttribute('aria-busy','true');
   results.querySelector('[data-selection-error]')?.remove();
   try{
    if(Number(button.dataset.kind)===100){
     const success=await onArtist({id:String(button.dataset.id),name:button.dataset.name,color:'#646978'});
     if(success===false)throw new Error('Artist unavailable');
    }else await onAlbum(button.dataset.id);
    if(choice===selection&&openedSession===session&&dialog.open)dialog.close();
   }catch{
    if(choice===selection&&openedSession===session&&dialog.open)results.insertAdjacentHTML('afterbegin','<p class="archive-note" data-selection-error>Unable to open this record. Please try again.</p>');
   }finally{
    button.disabled=false;button.removeAttribute('aria-busy');
   }
  }
 };
 return {dialog, open};
}
