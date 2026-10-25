// The half-circle dials of the robot lab's "Cổng & chân" tab (N18 R4.5): a drive motor's percent, a servo's angle. Plain arithmetic on
// the page's angles (0° the right end, 90° the top, 180° the left end), so the SVG paths are text a test reads exactly.

/** A hundredth, and 0 where it would be −0: the text of a path is the same on every engine. */
const hundredth = (value: number) => Math.round(value * 100) / 100 + 0;

/** The point at `angleDeg` on the circle of radius `r` around (cx, cy), in the page's coordinates (y grows downward). */
export function polar(cx: number, cy: number, r: number, angleDeg: number): [number, number] {
  const radians = (angleDeg * Math.PI) / 180;
  return [hundredth(cx + r * Math.cos(radians)), hundredth(cy - r * Math.sin(radians))];
}

/** The angle of the needle for `value` on a dial from `min` (the left end, 180°) to `max` (the right end, 0°); the ends hold beyond the range. */
export function needleAngle(value: number, min: number, max: number): number {
  const share = Math.min(1, Math.max(0, (value - min) / (max - min)));
  return hundredth(180 - share * 180);
}

/** The path of the arc of radius `r` from `fromDeg` to `toDeg`; empty for an arc of no length. */
export function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  if (fromDeg === toDeg) return '';
  const [x0, y0] = polar(cx, cy, r, fromDeg);
  const [x1, y1] = polar(cx, cy, r, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  // On the page a falling angle runs clockwise.
  const sweep = toDeg < fromDeg ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} ${sweep} ${x1} ${y1}`;
}
