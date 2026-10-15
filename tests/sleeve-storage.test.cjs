const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../js/three.module.js'), 'utf8');
const modules = Promise.all([import('data:text/javascript;base64,' + Buffer.from(source).toString('base64')), import('../js/sleeve-motion.mjs')]);
test('the record below the opening remains covered from front, back and oblique angles', async () => {
  const [THREE, dims] = await modules;
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(2, 2, dims.SLEEVE_DEPTH), new THREE.MeshBasicMaterial());
  const disc = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(dims.VINYL_RADIUS, dims.VINYL_RADIUS, .016, 44), new THREE.MeshBasicMaterial());
  body.rotation.x = Math.PI / 2; disc.add(body);
  dims.placeSleeveVinyl(sleeve, disc); disc.position.y = dims.VINYL_REST_Y;
  for (const angle of [0, .6, Math.PI / 2, Math.PI, Math.PI * 1.4]) {
    sleeve.rotation.y = angle; sleeve.updateMatrixWorld(true);
    for (const y of [-.4, .2, .5]) {
      const hit = new THREE.Raycaster(new THREE.Vector3(0, y, 3), new THREE.Vector3(0, 0, -1)).intersectObject(sleeve, true);
      assert.ok(hit[0]?.object === sleeve, 'cover must obscure the disc at angle ' + angle);
    }
  }
});
