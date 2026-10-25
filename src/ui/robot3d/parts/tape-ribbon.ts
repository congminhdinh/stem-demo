import { BoxGeometry, CylinderGeometry, type BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Arena } from '../../../core/world/arena/arena-schema';
import { arenaToThree } from '../scene-math';

// The tape's body in the 3D view (N18 R4.7 fix round 1, M7): vinyl tape is a little thick, so each line of the scenario's paint is also
// a thin black ribbon on the mat, its segments boxes as wide as the tape, round at its joints and ends as the painted tape is (round
// joins and caps, ground-paint.ts). The sensors read the paint; this is only seen.

/** How thick the tape stands on the mat (m). */
export const TAPE_THICKNESS_M = 0.0004;

/** The ribbon of every line of `arena`'s paint as one geometry, in three's frame (m); null when there is no tape. */
export function tapeRibbon(arena: Pick<Arena, 'paint'>): BufferGeometry | null {
  const parts: BufferGeometry[] = [];
  for (const line of arena.paint.lines) {
    const width = line.widthCm / 100;
    const points = line.pointsCm.map(([x, y]) => arenaToThree(x, y, 0));
    points.forEach(([x, , z], i) => {
      const joint = new CylinderGeometry(width / 2, width / 2, TAPE_THICKNESS_M, 20);
      joint.translate(x, TAPE_THICKNESS_M / 2, z);
      parts.push(joint);
      const next = points[i + 1];
      if (!next) return;
      const length = Math.hypot(next[0] - x, next[2] - z);
      if (length < 1e-6) return;
      const piece = new BoxGeometry(length, TAPE_THICKNESS_M, width);
      piece.rotateY(-Math.atan2(next[2] - z, next[0] - x));
      piece.translate((x + next[0]) / 2, TAPE_THICKNESS_M / 2, (z + next[2]) / 2);
      parts.push(piece);
    });
  }
  if (parts.length === 0) return null;
  const merged = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  return merged;
}
