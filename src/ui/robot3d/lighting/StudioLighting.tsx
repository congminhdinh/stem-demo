import { useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { Fog, PMREMGenerator, type DirectionalLight, type Scene } from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { ArenaSpan } from '../camera';
import { robot3dColors as colors } from '../colors';
import type { TierLook } from './look';

// The 3D view's light (N18 R4.7), set like a small product shot: an image-based studio environment (three's RoomEnvironment, rendered
// once into a PMREM: soft ambient light and reflections on metal and plastic, no HDR download), a warm key light from the camera's
// left and above, which casts the soft shadows on the high tier (PCF with a Vogel disk, `shadowRadius` texels), a cool rim light from
// behind that draws the robot's edges, a faint sky/ground fill, and fog of the studio's colour so the floor far off fades into it. The
// tone mapping (Khronos PBR Neutral) and the output colour space are the canvas's (Scene.tsx).

type StudioLightingProps = {
  span: ArenaSpan;
  look: TierLook;
  shadows: boolean;
  mapSize: number;
  /** The overview camera's forward direction on the floor (three's x, z). */
  viewForward: readonly [number, number];
};

/**
 * The room's environment map for this renderer, made when the canvas mounts and disposed when it unmounts; none when `intensity` is 0.
 * It is made in the effect, not in a memo: React's StrictMode (dev) runs an effect, its cleanup and the effect again, and a target made
 * once and disposed in the first cleanup would leave the scene lit by a disposed map (no image-based light).
 */
export function useStudioEnvironment(intensity: number) {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene) as Scene;
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    if (intensity === 0) return;
    const generator = new PMREMGenerator(gl);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);
    room.traverse((node) => {
      const mesh = node as { geometry?: { dispose(): void }; material?: { dispose(): void } };
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    });
    generator.dispose();
    scene.environment = target.texture;
    scene.environmentIntensity = intensity;
    invalidate();
    return () => {
      if (scene.environment === target.texture) scene.environment = null;
      target.dispose();
    };
  }, [gl, scene, intensity, invalidate]);
}

export function StudioLighting({ span, look, shadows, mapSize, viewForward }: StudioLightingProps) {
  useStudioEnvironment(look.environment);
  const scene = useThree((state) => state.scene) as Scene;
  const key = useRef<DirectionalLight>(null);
  const rim = useRef<DirectionalLight>(null);
  const reach = Math.max(span.widthM, span.depthM);
  const centre: [number, number, number] = [span.widthM / 2, 0, -span.depthM / 2];
  const [fx, fz] = viewForward;
  // The key comes from behind the camera's left shoulder, high; the rim from in front of the camera, low, a little to the right.
  const turn = (x: number, z: number, angle: number): [number, number] => [x * Math.cos(angle) - z * Math.sin(angle), x * Math.sin(angle) + z * Math.cos(angle)];
  const [kx, kz] = turn(-fx, -fz, -0.75);
  const [rx, rz] = turn(fx, fz, 0.5);
  const keyAt: [number, number, number] = [centre[0] + kx * reach * 0.9, reach * 1.25, centre[2] + kz * reach * 0.9];
  const rimAt: [number, number, number] = [centre[0] + rx * reach, reach * 0.8, centre[2] + rz * reach];

  useLayoutEffect(() => {
    for (const light of [key.current, rim.current]) {
      if (!light) continue;
      light.target.position.set(...centre);
      light.target.updateMatrixWorld();
    }
    const sun = key.current;
    if (!sun) return;
    const half = reach / 2 + 0.45;
    const camera = sun.shadow.camera;
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.near = 0.05;
    camera.far = reach * 5;
    camera.updateProjectionMatrix();
    sun.shadow.radius = look.shadowRadius;
    sun.shadow.needsUpdate = true;
  });

  useEffect(() => {
    scene.fog = new Fog(colors.studioFog, reach * 2.2 + 1.5, reach * 6 + 6);
    return () => {
      scene.fog = null;
    };
  }, [scene, reach]);

  return (
    <>
      <hemisphereLight args={[colors.sky, colors.ground, look.fill]} />
      <directionalLight
        ref={key}
        position={keyAt}
        color={colors.sun}
        intensity={3}
        castShadow={shadows}
        shadow-mapSize={[mapSize || 512, mapSize || 512]}
        shadow-bias={-0.0002}
        shadow-normalBias={0.0025}
      />
      <directionalLight ref={rim} position={rimAt} color={colors.rim} intensity={0.8} />
    </>
  );
}
