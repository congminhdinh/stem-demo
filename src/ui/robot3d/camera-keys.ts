import type { CameraCommand } from './camera-commands';
import type { Vec3Tuple } from './scene-math';

// The camera by keyboard (N18 R8): which key is which command, and the arithmetic of one step. Active only while the 3D view has the
// focus and never for a key typed into a field or the block editor (use-camera-keys.ts); Ctrl, Meta and Alt are the browser's and the
// system's, never the camera's.
//
//   1  2  3         Tự do · Theo xe · Nhìn từ trên            (a held key acts once)
//   0  Home         put the current view back where it starts (a held key acts once)
//   +  −            zoom in · out                              (= and _ are the same keys without Shift; the numeric keypad's too)
//   Shift + arrows  orbit (pan in the top view)               (plain arrows drive the robot in teleop and nudge the move tool)

/** What the camera reads of a key event. */
export type KeyLike = { readonly key: string; readonly code: string; readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean; readonly altKey: boolean; readonly repeat: boolean };

/** One orbit step, radians (7.5°): a held key sweeps round in a few seconds. */
export const ORBIT_STEP_RAD = (7.5 * Math.PI) / 180;
/** One zoom step: the share of its distance the camera keeps (zooming in) or its inverse (out). */
export const ZOOM_FACTOR = 0.85;
/** The least polar angle (from the vertical) an orbit goes to, so that it never flips over the top. */
const MIN_POLAR_RAD = 0.05;

const modeKeys: Readonly<Record<string, 'orbit' | 'follow' | 'top'>> = { '1': 'orbit', '2': 'follow', '3': 'top' };
const arrows: Readonly<Record<string, readonly [-1 | 0 | 1, -1 | 0 | 1]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };

/** The digit a key is, by its text or by the digit row's and the keypad's place (any layout, any input method), else null. */
function digitOf({ key, code }: KeyLike): string | null {
  if (/^[0-9]$/.test(key)) return key;
  const place = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  return place?.[1] ?? null;
}

/** The command a key is, or null. */
export function cameraKeyOf(event: KeyLike): CameraCommand | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.shiftKey) {
    const arrow = arrows[event.key];
    if (arrow !== undefined) return { kind: 'orbit', dx: arrow[0], dy: arrow[1] };
  }
  if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') return { kind: 'zoom', direction: 'in' };
  if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') return { kind: 'zoom', direction: 'out' };
  // A view or a reset acts once however long the key is held, and is not a symbol typed with Shift on another layout.
  if (event.shiftKey || event.repeat) return null;
  if (event.key === 'Home') return { kind: 'reset' };
  const digit = digitOf(event);
  if (digit === '0') return { kind: 'reset' };
  const mode = digit === null ? undefined : modeKeys[digit];
  return mode === undefined ? null : { kind: 'mode', mode };
}

/**
 * The camera's offset from its target after one orbit step: swung round the vertical by `dx` steps (positive: to the camera's right), and
 * raised by `dy` steps (positive: up), `stepRad` each, at the same distance. The polar angle (from the vertical) stays between a few
 * hundredths of a radian and `maxPolarRad`, the view's limit above the floor.
 */
export function orbitedOffset([x, y, z]: Vec3Tuple, dx: number, dy: number, stepRad: number, maxPolarRad: number): Vec3Tuple {
  const radius = Math.hypot(x, y, z);
  if (radius === 0) return [0, 0, 0];
  const azimuth = Math.atan2(x, z) + dx * stepRad;
  const polar = Math.min(maxPolarRad, Math.max(MIN_POLAR_RAD, Math.acos(Math.max(-1, Math.min(1, y / radius))) - dy * stepRad));
  return [radius * Math.sin(polar) * Math.sin(azimuth), radius * Math.cos(polar), radius * Math.sin(polar) * Math.cos(azimuth)];
}

/** The camera's offset from its target after one zoom step, in the same direction, its distance kept within `min` and `max`. */
export function zoomedOffset([x, y, z]: Vec3Tuple, direction: 'in' | 'out', min: number, max: number): Vec3Tuple {
  const radius = Math.hypot(x, y, z);
  if (radius === 0) return [0, 0, 0];
  const wanted = direction === 'in' ? radius * ZOOM_FACTOR : radius / ZOOM_FACTOR;
  const scale = Math.min(max, Math.max(min, wanted)) / radius;
  return [x * scale, y * scale, z * scale];
}
