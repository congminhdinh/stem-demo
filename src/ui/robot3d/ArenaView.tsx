import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { CanvasTexture, SRGBColorSpace, type Group } from 'three';
import type { Arena, PaintZone } from '../../core/world/arena/arena-schema';
import type { RobotSnapshot } from '../../core/world/snapshot';
import { robot3dColors as colors } from './colors';
import { groundTextureSize, paintGround } from './ground-paint';
import { arenaToThree, boxBody, cylinderBody, dynamicBodyIds, wallBox, writePose } from './scene-math';

// The arena in the 3D view (N18 R4.2), drawn from the scenario's `Arena`: the floor with its zones and tape (one texture painted from
// the vector paint, ground-paint.ts), on a slab on a table; the walls; the fixed boxes and cylinders; and the bodies that move (dynamic
// boxes and cylinders, the objects to push), whose poses are read from the world in the frame callback, as the robot's are.

type ArenaViewProps = {
  arena: Arena;
  view: () => RobotSnapshot;
  shadows: boolean;
  /** A zone's name painted on the floor (the learner's words), or null. */
  zoneLabel: (zone: PaintZone) => string | null;
};

const SLAB_M = 0.012;

/** The floor's texture: the paint on a canvas, as sharp as the renderer allows (at most 8 px a cm). */
function useFloorTexture(arena: Arena, zoneLabel: ArenaViewProps['zoneLabel']): CanvasTexture | null {
  const gl = useThree((state) => state.gl);
  const texture = useMemo(() => {
    const { pxPerCm, width, height } = groundTextureSize(arena.ground.sizeCm, Math.min(4096, gl.capabilities.maxTextureSize));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) {
      return null;
    }
    paintGround(ctx, arena, { pxPerCm, zoneLabel, patterns: true });
    const painted = new CanvasTexture(canvas);
    painted.colorSpace = SRGBColorSpace;
    painted.anisotropy = Math.min(8, gl.capabilities.getMaxAnisotropy());
    return painted;
  }, [arena, gl, zoneLabel]);
  useEffect(() => () => texture?.dispose(), [texture]);
  return texture;
}

/** What a moving body looks like: its shape and size, from the arena's data. */
type MovingShape = { id: string; color: string } & ({ shape: 'box'; size: readonly [number, number, number] } | { shape: 'cylinder'; radiusM: number; heightM: number });

function movingShapes(arena: Arena): MovingShape[] {
  const ids = dynamicBodyIds(arena);
  const shapes: Omit<MovingShape, 'id'>[] = [
    ...arena.boxes.filter((box) => box.body === 'dynamic').map((box) => ({ shape: 'box' as const, size: boxBody(box).size, color: colors.box })),
    ...arena.cylinders
      .filter((cylinder) => cylinder.body === 'dynamic')
      .map((cylinder) => ({ shape: 'cylinder' as const, ...cylinderBody(cylinder), color: colors.cylinder })),
    ...arena.objects.map((object) =>
      object.shape === 'box' ? { shape: 'box' as const, size: boxBody(object).size, color: colors.object } : { shape: 'cylinder' as const, ...cylinderBody(object), color: colors.object },
    ),
  ];
  return shapes.map((shape, i) => ({ ...shape, id: ids[i]! }) as MovingShape);
}

export function ArenaView({ arena, view, shadows, zoneLabel }: ArenaViewProps) {
  const floor = useFloorTexture(arena, zoneLabel);
  const [widthCm, depthCm] = arena.ground.sizeCm;
  const centre = arenaToThree(widthCm / 2, depthCm / 2, 0);
  const [width, depth] = [widthCm / 100, depthCm / 100];
  const moving = useMemo(() => movingShapes(arena), [arena]);
  const movingRefs = useRef<(Group | null)[]>([]);

  useFrame(() => {
    const world = view();
    for (const object of world.objects) {
      const index = moving.findIndex((shape) => shape.id === object.id);
      const group = movingRefs.current[index];
      if (group) writePose(group, object.pose);
    }
  });

  return (
    <group name="arena">
      {/* The table under the arena, the arena's slab, and its painted floor. */}
      <mesh rotation-x={-Math.PI / 2} position={[centre[0], -SLAB_M - 0.0005, centre[2]]} receiveShadow={shadows}>
        <planeGeometry args={[Math.max(width, depth) * 8, Math.max(width, depth) * 8]} />
        <meshStandardMaterial color={colors.table} roughness={1} />
      </mesh>
      <mesh position={[centre[0], -SLAB_M / 2, centre[2]]} receiveShadow={shadows}>
        <boxGeometry args={[width, SLAB_M - 0.0002, depth]} />
        <meshStandardMaterial color={colors.wall} roughness={0.9} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[centre[0], 0, centre[2]]} receiveShadow={shadows}>
        <planeGeometry args={[width, depth]} />
        {floor ? <meshStandardMaterial map={floor} roughness={0.95} /> : <meshStandardMaterial color={arena.ground.color} roughness={0.95} />}
      </mesh>

      {arena.walls.map((wall, i) => {
        const { position, size, yawRad } = wallBox(wall);
        return (
          <mesh key={wall.id ?? `#wall-${i}`} position={position as [number, number, number]} rotation-y={yawRad} castShadow={shadows} receiveShadow={shadows}>
            <boxGeometry args={size as [number, number, number]} />
            <meshStandardMaterial color={colors.wall} roughness={0.75} />
          </mesh>
        );
      })}

      {arena.boxes.map((box, i) =>
        box.body === 'fixed' ? (
          <mesh key={box.id ?? `#box-${i}`} position={boxBody(box).position as [number, number, number]} rotation-y={boxBody(box).yawRad} castShadow={shadows} receiveShadow={shadows}>
            <boxGeometry args={boxBody(box).size as [number, number, number]} />
            <meshStandardMaterial color={colors.box} roughness={0.7} />
          </mesh>
        ) : null,
      )}
      {arena.cylinders.map((cylinder, i) => {
        if (cylinder.body !== 'fixed') return null;
        const { position, radiusM, heightM } = cylinderBody(cylinder);
        return (
          <mesh key={cylinder.id ?? `#cylinder-${i}`} position={position as [number, number, number]} castShadow={shadows} receiveShadow={shadows}>
            <cylinderGeometry args={[radiusM, radiusM, heightM, 24]} />
            <meshStandardMaterial color={colors.cylinder} roughness={0.6} />
          </mesh>
        );
      })}

      {moving.map((shape, i) => (
        <group
          key={shape.id}
          ref={(group) => {
            movingRefs.current[i] = group;
          }}
        >
          <mesh castShadow={shadows} receiveShadow={shadows}>
            {shape.shape === 'box' ? <boxGeometry args={shape.size as [number, number, number]} /> : <cylinderGeometry args={[shape.radiusM, shape.radiusM, shape.heightM, 24]} />}
            <meshStandardMaterial color={shape.color} roughness={0.6} />
          </mesh>
        </group>
      ))}
    </group>
  );
}
