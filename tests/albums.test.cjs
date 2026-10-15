const { test } = require('node:test');
const assert = require('node:assert/strict');
const { selectStudioAlbums } = require('../lib/music');
const album = (id, name, changes={}) => ({id,name,type:'专辑',subType:'录音室版',size:12,publishTime:id,...changes});
test('retain studio albums, remove singles, EPs, live, remixes and compilations', () => {
 const releases=[album(1,'30'),album(2,'Hello',{type:'Single',size:1}),album(3,'Sessions',{type:'EP',size:6}),album(4,'Live At The Royal Albert Hall',{subType:'现场版'}),album(5,'30 (Remixes)',{subType:'Remix'}),album(6,'Greatest Hits'),album(7,'Long.Live.A$AP'),album(8,'Dangerous'),album(9,'ye',{size:7}),album(10,'The Collection',{subType:'精选集'})];
 assert.deepEqual(selectStudioAlbums(releases).map(a=>a.name),['30','Long.Live.A$AP','Dangerous','ye']);
});
test('prefer standard release over deluxe and bonus duplicates, preserve deluxe-only albums', () => {
 const releases=[album(3,'19',{size:22}),album(2,'19',{size:12}),album(4,'19 (Deluxe Edition)',{size:27}),album(6,'BULLY - DELUXE'),album(5,'30 (Expanded)'),album(1,'30')];
 assert.deepEqual(selectStudioAlbums(releases).map(a=>a.id),[1,2,6]);
});
test('metadata-free songs are excluded, known short full-length albums are retained', () => {
 assert.equal(selectStudioAlbums([{id:1,name:'Single',size:1},album(2,'Short LP',{size:5})]).length,1);
});
test('large discographies have sleeve clearance without moving the front record', async () => {
 const { albumPosition }=await import('../js/carousel-layout.mjs');
 for(const count of [2,8,16,30,80]){
  const front=albumPosition(count,0,0), next=albumPosition(count,1,0);
  assert.ok(Math.hypot(next.x-front.x,next.z-front.z)>=2.4-1e-8,`overlap for ${count}`);
  assert.equal(front.z,5.7);
 }
});
