// Keep the original paper sleeve; the stored record fits behind both artwork faces.
export const SLEEVE_DEPTH = .012;
export const VINYL_DEPTH = 0;
export const VINYL_RADIUS = .68;
export const VINYL_REST_Y = .46;
export const VINYL_PREVIEW_Y = 1.4;
export const VINYL_ENTRY_Y = 0;
export const VINYL_THICKNESS_SCALE = .35;
export function placeSleeveVinyl(sleeve, vinyl) {
  vinyl.position.set(0, VINYL_ENTRY_Y, VINYL_DEPTH);
  vinyl.scale.z = VINYL_THICKNESS_SCALE;
  sleeve.add(vinyl);
}
export function moveSleeveVinyl(card, target, dt) {
  const delta = target - card.v.position.y;
  card.v.position.y = Math.abs(delta) <= .0005 ? target : card.v.position.y + delta * Math.min(8 * Math.max(0, dt), 1);
}
const smooth = t => t * t * (3 - 2 * t);
export function nearestSleeveAngle(target, from = 0) {
  const turn = Math.PI * 2;
  return from + ((target - from + Math.PI) % turn + turn) % turn - Math.PI;
}
export function beginSleeveReturn(card) {
  card.returnMotion = { elapsed: 0, from: card.flipAngle || 0, groupFrom: card.g.rotation.y, groupTo: nearestSleeveAngle(card.rry, card.g.rotation.y) };
  card.flipTarget = 0;
  // Never expose the disc while the sleeve turns independently of it.
  card.v.visible = false;
}
export function settleSleeveReturn(card, dt, reduced = false) {
  const motion = card.returnMotion;
  if (!motion) return false;
  motion.elapsed += Math.max(0, dt);
  const t = reduced || Math.abs(motion.from) < .001 ? 1 : Math.min(1, motion.elapsed / .28);
  const eased = smooth(t);
  card.flipAngle = t === 1 ? 0 : motion.from * (1 - eased);
  card.mesh.rotation.y = card.flipAngle;
  card.v.visible = false;
  return t === 1;
}
