const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../js/sleeve-motion.mjs');
function card(angle = Math.PI) {
  return { flipAngle: angle, flipTarget: angle, mesh: { rotation: { y: angle } }, g: { rotation: { y: 0 } }, rry: .35, v: { visible: true, position: { y: 0 } } };
}
test('returning a flipped sleeve keeps the vinyl hidden until it is flush again', async () => {
  const { beginSleeveReturn, settleSleeveReturn } = await modulePromise;
  const c = card(); beginSleeveReturn(c); assert.equal(c.v.visible, false);
  const angles = [];
  for (let i = 0; i < 16; i++) {
    assert.equal(settleSleeveReturn(c, 1 / 60), false);
    assert.equal(c.v.visible, false); assert.equal(c.g.rotation.y, 0);
    assert.equal(c.mesh.rotation.y, c.flipAngle); angles.push(c.flipAngle);
  }
  assert.ok(angles.every((value, i) => value > 0 && (i === 0 || value < angles[i - 1])));
  assert.equal(settleSleeveReturn(c, 1 / 60), true); assert.equal(c.mesh.rotation.y, 0); assert.equal(c.flipTarget, 0);
});
test('returning midway through a flip begins at the actual angle without a snap', async () => {
  const { beginSleeveReturn, settleSleeveReturn } = await modulePromise;
  for (const angle of [.2, Math.PI / 2, 2.8]) {
    const c = card(angle); beginSleeveReturn(c); settleSleeveReturn(c, 0);
    assert.equal(c.mesh.rotation.y, angle);
    assert.equal(settleSleeveReturn(c, .28), true); assert.equal(c.mesh.rotation.y, 0);
  }
});
test('an unflipped sleeve and reduced-motion returns have no decorative wait', async () => {
  const { beginSleeveReturn, settleSleeveReturn } = await modulePromise;
  const front = card(0); beginSleeveReturn(front); assert.equal(settleSleeveReturn(front, 0), true);
  const back = card(); beginSleeveReturn(back); assert.equal(settleSleeveReturn(back, 0, true), true); assert.equal(back.mesh.rotation.y, 0);
});
test('returning uses the nearest equivalent orientation even after repeated carousel turns', async () => {
  const { nearestSleeveAngle } = await modulePromise;
  for (const target of [-50, -7, -.4, .3, 8, 50]) {
    const result = nearestSleeveAngle(target);
    assert.ok(Math.abs(result) <= Math.PI);
    assert.ok(Math.abs(Math.sin(result) - Math.sin(target)) < 1e-12);
    assert.ok(Math.abs(Math.cos(result) - Math.cos(target)) < 1e-12);
  }
});
test('a returned record fits between both thin cover faces', async () => {
  const { VINYL_DEPTH, SLEEVE_DEPTH, VINYL_THICKNESS_SCALE, VINYL_RADIUS, VINYL_REST_Y, VINYL_PREVIEW_Y } = await modulePromise;
  assert.ok(VINYL_DEPTH + .008 * VINYL_THICKNESS_SCALE < SLEEVE_DEPTH / 2);
  assert.ok(VINYL_DEPTH - .008 * VINYL_THICKNESS_SCALE > -SLEEVE_DEPTH / 2);
  assert.ok(VINYL_RADIUS + VINYL_REST_Y > 1);
  assert.ok(VINYL_RADIUS + VINYL_REST_Y <= 1.16);
  assert.ok(VINYL_PREVIEW_Y > 1);
});

test('hover pulls the record out and leaving slides it back to a small visible rim without changing depth', async () => {
  const { moveSleeveVinyl, VINYL_PREVIEW_Y, VINYL_REST_Y } = await modulePromise;
  const c = card(0); c.v.position.z = 0;
  let before = 0;
  for (let i = 0; i < 90; i++) {
    moveSleeveVinyl(c, VINYL_PREVIEW_Y, 1 / 60);
    assert.ok(c.v.position.y >= before && c.v.position.y <= VINYL_PREVIEW_Y); before = c.v.position.y;
  }
  assert.equal(c.v.position.y, VINYL_PREVIEW_Y);
  for (let i = 0; i < 90; i++) {
    moveSleeveVinyl(c, VINYL_REST_Y, 1 / 60);
    assert.ok(c.v.position.y <= before && c.v.position.y >= VINYL_REST_Y); before = c.v.position.y;
  }
  assert.equal(c.v.position.y, VINYL_REST_Y); assert.equal(c.v.position.z, 0);
});
