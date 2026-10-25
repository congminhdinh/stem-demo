import { describe, expect, it } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { chasePose, overviewPose, topPose, type CameraPose } from './camera';
import { clientToNdc, pickFloor } from './floor-pick';
import { arenaToThree, threeToArena } from './scene-math';
import { arenaToStage, fitTopView, stageToArena } from './top-view-math';

// N18 R4.8: the ruler and the move tool pick a point of the mat under the pointer. In the 3D view the pointer's ray meets the floor plane
// (the mat, y = 0 m) and the hit goes back to the arena's cm through scene-math (the frame the view draws in); on the 2D map the stage
// point goes back through the map's own fit. A pick must be exact: within 0.5 cm of where the point really is.

const FOV_DEG = 40;
const span = { widthM: 2, depthM: 1.2 };
const rect = { left: 30, top: 80, width: 800, height: 500 };
const aspect = rect.width / rect.height;

function cameraAt(pose: CameraPose): PerspectiveCamera {
  const camera = new PerspectiveCamera(FOV_DEG, aspect, 0.01, 60);
  camera.position.set(...pose.position);
  camera.lookAt(new Vector3(...pose.target));
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

/** The client point (px) where `camera` shows the arena point (cm, on the floor). */
function clientOf(camera: PerspectiveCamera, xCm: number, yCm: number): [number, number] {
  const ndc = new Vector3(...arenaToThree(xCm, yCm, 0)).project(camera);
  return [rect.left + ((ndc.x + 1) / 2) * rect.width, rect.top + ((1 - ndc.y) / 2) * rect.height];
}

const pick = (camera: PerspectiveCamera, clientX: number, clientY: number) => pickFloor(clientToNdc(clientX, clientY, rect), camera.matrixWorld.elements, camera.projectionMatrixInverse.elements);

describe('threeToArena (N18 R4.8)', () => {
  it('is arenaToThree undone: (x, y, z) m in three is (100x, −100z, 100y) cm in the arena', () => {
    expect(threeToArena(1.25, 0.03, -0.4)).toEqual([125, 40, 3]);
    expect(threeToArena(...arenaToThree(12.5, 33, 4))).toEqual([12.5, 33, 4]);
    expect(Object.is(threeToArena(0, 0, 0)[1], 0)).toBe(true);
  });
});

describe('pickFloor in the 3D view (N18 R4.8)', () => {
  it('turns a client point into normalised device coordinates over the canvas', () => {
    expect(clientToNdc(30, 80, rect)).toEqual([-1, 1]);
    expect(clientToNdc(830, 580, rect)).toEqual([1, -1]);
    expect(clientToNdc(430, 330, rect)).toEqual([0, 0]);
  });

  it('straight down (Nhìn từ trên): the middle of the canvas is the arena’s middle, and a point off it is where the field of view puts it', () => {
    const pose = topPose(span, FOV_DEG, aspect);
    const camera = cameraAt(pose);
    const height = pose.position[1];
    const middle = pick(camera, 430, 330)!;
    expect(middle.xCm).toBeCloseTo(100, 1);
    expect(middle.yCm).toBeCloseTo(60, 1);
    // Half way to the right edge: x is height · tan(20°) · aspect / 2 further, in cm.
    const right = pick(camera, 630, 330)!;
    expect(Math.abs(right.xCm - (100 + height * Math.tan((20 * Math.PI) / 180) * aspect * 0.5 * 100))).toBeLessThan(0.5);
    expect(Math.abs(right.yCm - 60)).toBeLessThan(0.5);
    // Up the screen is away (+y).
    const up = pick(camera, 430, 205)!;
    expect(Math.abs(up.yCm - (60 + height * Math.tan((20 * Math.PI) / 180) * 0.5 * 100))).toBeLessThan(0.5);
  });

  it('in every camera view, a pick where a known point of the mat shows gives that point within 0.5 cm', () => {
    const poses = [
      overviewPose(span, FOV_DEG, aspect),
      topPose(span, FOV_DEG, aspect),
      chasePose(arenaToThree(40, 60, 0), (30 * Math.PI) / 180),
    ];
    const points: [number, number][] = [
      [40, 60],
      [100, 60],
      [10, 10],
      [190, 110],
      [72.5, 33.3],
    ];
    for (const pose of poses) {
      const camera = cameraAt(pose);
      for (const [xCm, yCm] of points) {
        const [cx, cy] = clientOf(camera, xCm, yCm);
        // The chase view sees only what is ahead of the robot; a point behind its camera is not on the canvas.
        if (cx < rect.left || cx > rect.left + rect.width || cy < rect.top || cy > rect.top + rect.height) continue;
        const hit = pick(camera, cx, cy)!;
        expect(Math.hypot(hit.xCm - xCm, hit.yCm - yCm)).toBeLessThan(0.5);
      }
    }
  });

  it('gives nothing for a ray that never meets the floor ahead (above the horizon)', () => {
    const camera = cameraAt({ position: [1, 0.1, 0.5], target: [1, 0.1, -2] });
    expect(pick(camera, 430, 100)).toBeNull();
    expect(pick(camera, 430, 330)).toBeNull();
    expect(pick(camera, 430, 560)).not.toBeNull();
  });
});

describe('stageToArena on the 2D map (N18 R4.8)', () => {
  it('is the map’s fit undone: the arena’s corners and middle come back exactly, and arenaToStage goes the other way', () => {
    const fit = fitTopView([200, 120], { width: 660, height: 460 }, { left: 14, right: 14, top: 14, bottom: 40 });
    const lowerLeft = { x: fit.originX, y: fit.originY };
    expect(stageToArena(fit, lowerLeft.x, lowerLeft.y)).toEqual({ xCm: 0, yCm: 0 });
    const far = stageToArena(fit, fit.originX + 200 * fit.scale, fit.originY - 120 * fit.scale);
    expect(far.xCm).toBeCloseTo(200, 9);
    expect(far.yCm).toBeCloseTo(120, 9);
    const stage = arenaToStage(fit, { xCm: 72.5, yCm: 33.3 });
    const back = stageToArena(fit, stage.x, stage.y);
    expect(back.xCm).toBeCloseTo(72.5, 9);
    expect(back.yCm).toBeCloseTo(33.3, 9);
  });
});
