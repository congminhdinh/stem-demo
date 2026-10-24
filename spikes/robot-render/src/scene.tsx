// Procedural arena + robot for the render spike (N18 R0.2). Everything is a primitive mesh: no GLB, no textures.
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { ARENA, linePath, POSE_STRIDE, TICK_HZ, TICKS, WHEEL_RADIUS, TRACK } from './path';

export interface Sim {
  running: boolean;
  time: number; // virtual seconds
}

interface ShadowProps {
  shadows: boolean;
}

const LINE_WIDTH = 0.02;

/** A flat ribbon along the closed line path, lying 1.5 mm above the ground. */
function useLineGeometry(): THREE.BufferGeometry {
  return useMemo(() => {
    const path = linePath(240);
    const n = path.length;
    const positions = new Float32Array(n * 2 * 3);
    const index: number[] = [];
    for (let i = 0; i < n; i += 1) {
      const prev = path[(i + n - 1) % n]!;
      const next = path[(i + 1) % n]!;
      const p = path[i]!;
      const tx = next.x - prev.x;
      const tz = next.z - prev.z;
      const length = Math.hypot(tx, tz);
      const nx = -tz / length;
      const nz = tx / length;
      positions.set([p.x + (nx * LINE_WIDTH) / 2, 0.0015, p.z + (nz * LINE_WIDTH) / 2], i * 6);
      positions.set([p.x - (nx * LINE_WIDTH) / 2, 0.0015, p.z - (nz * LINE_WIDTH) / 2], i * 6 + 3);
      const j = (i + 1) % n;
      index.push(i * 2, j * 2, i * 2 + 1, i * 2 + 1, j * 2, j * 2 + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(index);
    geometry.computeVertexNormals();
    return geometry;
  }, []);
}

const zones: { color: string; x: number; z: number }[] = [
  { color: '#2ea44f', x: 0.68, z: 0.5 }, // start
  { color: '#d1453b', x: -0.68, z: -0.5 }, // goal
  { color: '#2f6fd1', x: 0, z: 0.5 }, // checkpoint
  { color: '#e0b21b', x: 0, z: -0.5 }, // hazard
];

const obstacles: { x: number; z: number; w: number; h: number; d: number; color: string }[] = [
  { x: 0.2, z: 0.1, w: 0.16, h: 0.12, d: 0.16, color: '#c9753d' },
  { x: -0.3, z: -0.1, w: 0.2, h: 0.1, d: 0.12, color: '#7a8f3a' },
  { x: 0.05, z: -0.2, w: 0.12, h: 0.16, d: 0.12, color: '#8a5fb0' },
];

export function Arena({ shadows }: ShadowProps) {
  const line = useLineGeometry();
  const half = ARENA / 2;
  const wall = 0.03;
  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} receiveShadow={shadows}>
        <planeGeometry args={[ARENA, ARENA]} />
        <meshStandardMaterial color="#eef1f4" roughness={0.9} />
      </mesh>
      {zones.map((zone) => (
        <mesh key={zone.color} rotation-x={-Math.PI / 2} position={[zone.x, 0.0008, zone.z]} receiveShadow={shadows}>
          <planeGeometry args={[0.3, 0.3]} />
          <meshStandardMaterial color={zone.color} roughness={0.9} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
        </mesh>
      ))}
      <mesh geometry={line} receiveShadow={shadows}>
        <meshStandardMaterial color="#0b0b0d" roughness={0.8} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
      </mesh>
      {(
        [
          [0, -half - wall / 2, ARENA + wall * 2, wall],
          [0, half + wall / 2, ARENA + wall * 2, wall],
          [-half - wall / 2, 0, wall, ARENA],
          [half + wall / 2, 0, wall, ARENA],
        ] as const
      ).map(([x, z, w, d]) => (
        <mesh key={`${x}:${z}`} position={[x, 0.04, z]} castShadow={shadows} receiveShadow={shadows}>
          <boxGeometry args={[w, 0.08, d]} />
          <meshStandardMaterial color="#5b6b7d" roughness={0.7} />
        </mesh>
      ))}
      {obstacles.map((box) => (
        <mesh key={`${box.x}:${box.z}`} position={[box.x, box.h / 2, box.z]} castShadow={shadows} receiveShadow={shadows}>
          <boxGeometry args={[box.w, box.h, box.d]} />
          <meshStandardMaterial color={box.color} roughness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

function Wheel({ side, wheelRef, shadows }: { side: 1 | -1; wheelRef: RefObject<THREE.Group | null>; shadows: boolean }) {
  return (
    <group ref={wheelRef} position={[0, WHEEL_RADIUS, (side * TRACK) / 2]}>
      <mesh rotation-x={Math.PI / 2} castShadow={shadows}>
        <cylinderGeometry args={[WHEEL_RADIUS, WHEEL_RADIUS, 0.02, 24]} />
        <meshStandardMaterial color="#1a1a1c" roughness={0.9} />
      </mesh>
      {/* a hub marker so the rolling is visible */}
      <mesh position={[WHEEL_RADIUS * 0.6, 0, side * 0.0105]}>
        <boxGeometry args={[0.012, 0.006, 0.002]} />
        <meshStandardMaterial color="#f2f2f2" />
      </mesh>
    </group>
  );
}

/** Box chassis, two wheels, a caster, a board, an ultrasonic stub and three line-sensor stubs. */
export function Robot({ shadows, sim, poses, phase = 0 }: ShadowProps & { sim: RefObject<Sim>; poses: Float32Array; phase?: number }) {
  const body = useRef<THREE.Group>(null);
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);

  useFrame(() => {
    const s = sim.current;
    const f = (s.time * TICK_HZ + phase) % TICKS; // `phase` (ticks) offsets the extra stress-test robots
    const i = Math.floor(f);
    const k = f - i;
    const a = i * POSE_STRIDE;
    const b = ((i + 1) % TICKS) * POSE_STRIDE;
    const lerp = (o: number) => poses[a + o]! + (poses[b + o]! - poses[a + o]!) * k;
    const dPhi = Math.atan2(Math.sin(poses[b + 2]! - poses[a + 2]!), Math.cos(poses[b + 2]! - poses[a + 2]!));
    if (body.current) {
      body.current.position.set(lerp(0), 0, lerp(1));
      body.current.rotation.y = poses[a + 2]! + dPhi * k;
    }
    // Rolling forward turns a wheel about -z.
    if (left.current) left.current.rotation.z = -lerp(3);
    if (right.current) right.current.rotation.z = -lerp(4);
  });

  return (
    <group ref={body}>
      <mesh position={[0, 0.045, 0]} castShadow={shadows}>
        <boxGeometry args={[0.17, 0.04, 0.1]} />
        <meshStandardMaterial color="#2d7ff9" roughness={0.5} />
      </mesh>
      <mesh position={[-0.03, 0.073, 0]} castShadow={shadows}>
        <boxGeometry args={[0.07, 0.016, 0.054]} />
        <meshStandardMaterial color="#146b4a" roughness={0.6} />
      </mesh>
      <mesh position={[0.045, 0.072, 0]} castShadow={shadows}>
        <boxGeometry args={[0.05, 0.014, 0.036]} />
        <meshStandardMaterial color="#d9d9de" roughness={0.5} />
      </mesh>
      <Wheel side={-1} wheelRef={left} shadows={shadows} />
      <Wheel side={1} wheelRef={right} shadows={shadows} />
      <mesh position={[0.07, 0.016, 0]} castShadow={shadows}>
        <sphereGeometry args={[0.016, 16, 12]} />
        <meshStandardMaterial color="#9aa0a6" metalness={0.4} roughness={0.4} />
      </mesh>
      {/* ultrasonic stub: a plate with two round "eyes" */}
      <group position={[0.092, 0.058, 0]}>
        <mesh castShadow={shadows}>
          <boxGeometry args={[0.012, 0.022, 0.05]} />
          <meshStandardMaterial color="#1c5fc4" />
        </mesh>
        {([-0.013, 0.013] as const).map((z) => (
          <mesh key={z} position={[0.009, 0, z]} rotation-z={Math.PI / 2}>
            <cylinderGeometry args={[0.008, 0.008, 0.008, 16]} />
            <meshStandardMaterial color="#b8bcc2" metalness={0.5} roughness={0.4} />
          </mesh>
        ))}
      </group>
      {/* three line-sensor stubs under the nose */}
      {([-0.025, 0, 0.025] as const).map((z) => (
        <mesh key={z} position={[0.078, 0.021, z]}>
          <boxGeometry args={[0.012, 0.006, 0.014]} />
          <meshStandardMaterial color="#222" />
        </mesh>
      ))}
    </group>
  );
}
