// Preserve the front record's position while giving every sleeve enough physical room.
export function albumPosition(total, index, focus, width = 2, baseRadius = 5.2, y = .2, z = .5) {
  if (total <= 1) return { x: 0, y, z: z + baseRadius, ry: 0 };
  const angle = (index - focus) / total * Math.PI * 2;
  const radius = Math.max(baseRadius, (width + .4) / (2 * Math.sin(Math.PI / total)));
  return { x: radius * Math.sin(angle), y, z: z + baseRadius + radius * (Math.cos(angle) - 1), ry: angle };
}
