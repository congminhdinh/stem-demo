import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// Guards boundary B1 (plan §5.1): the lint rule in eslint.config.js must keep
// src/core free of UI frameworks and of the ui/storage layers.
const eslint = new ESLint();

async function boundaryViolations(code: string, filePath: string) {
  const results = await eslint.lintText(code, { filePath });
  return results
    .flatMap((result) => result.messages)
    .filter((message) => message.ruleId === 'no-restricted-imports');
}

describe('core boundary (B1)', () => {
  it.each([
    "import { useState } from 'react';",
    "import { jsx } from 'react/jsx-runtime';",
    "import Konva from 'konva';",
    "import * as Blockly from 'blockly';",
    "import { createStore } from 'zustand/vanilla';",
    "import Dexie from 'dexie';",
    "import { App } from '../ui/app/App';",
    "import { db } from '../../storage/db';",
  ])('rejects `%s` inside src/core', async (code) => {
    expect(await boundaryViolations(code, 'src/core/circuit/example.ts')).toHaveLength(1);
  });

  it('allows plain dependencies inside src/core', async () => {
    expect(await boundaryViolations("import { z } from 'zod';", 'src/core/circuit/example.ts')).toEqual([]);
  });

  it('allows framework imports outside src/core', async () => {
    expect(await boundaryViolations("import { useState } from 'react';", 'src/ui/app/example.ts')).toEqual([]);
  });
});

describe('persistence boundary (B8)', () => {
  it.each([
    "import Dexie from 'dexie';",
    "import { createDexieProjectRepository } from '../../storage/dexie-project-repository';",
  ])('rejects `%s` inside src/ui', async (code) => {
    expect(await boundaryViolations(code, 'src/ui/state/example.ts')).toHaveLength(1);
  });

  it('allows the storage implementation in the composition root and in src/storage', async () => {
    const code = "import { createDexieProjectRepository } from './storage/dexie-project-repository';";
    expect(await boundaryViolations(code, 'src/main.tsx')).toEqual([]);
    expect(await boundaryViolations("import Dexie from 'dexie';", 'src/storage/example.ts')).toEqual([]);
  });
});

// N18 (robot plan §5): 3D rendering stays in src/ui, the physics engine stays in src/core/world, and the
// world itself only uses the Math functions every JS engine computes bit for bit (D-R12, ADR 0001 §4.6).
async function ruleViolations(code: string, filePath: string, ruleId: string) {
  const results = await eslint.lintText(code, { filePath });
  return results.flatMap((result) => result.messages).filter((message) => message.ruleId === ruleId);
}

const outsideTheWorld = [
  'src/core/run/example.ts',
  'src/core/scenario/example.ts',
  'src/ui/robot3d/example.tsx',
  'src/storage/example.ts',
  'src/samples/example.ts',
  'src/main.tsx',
];

describe('core boundary (B1): no 3D rendering in src/core', () => {
  it.each([
    "import * as THREE from 'three';",
    "import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';",
    "import { Canvas } from '@react-three/fiber';",
    "import { Html } from '@react-three/drei';",
  ])('rejects `%s` inside src/core, src/core/world included', async (code) => {
    expect(await boundaryViolations(code, 'src/core/run/example.ts')).toHaveLength(1);
    expect(await boundaryViolations(code, 'src/core/world/example.ts')).toHaveLength(1);
  });

  it('allows three and R3F in src/ui', async () => {
    expect(await boundaryViolations("import { Canvas } from '@react-three/fiber';", 'src/ui/robot3d/Scene.tsx')).toEqual([]);
    expect(await boundaryViolations("import * as THREE from 'three';", 'src/ui/robot3d/Scene.tsx')).toEqual([]);
  });

  it('keeps the rest of B1 inside src/core/world', async () => {
    expect(await boundaryViolations("import { useState } from 'react';", 'src/core/world/example.ts')).toHaveLength(1);
    expect(await boundaryViolations("import { App } from '../../ui/app/App';", 'src/core/world/example.ts')).toHaveLength(1);
  });
});

describe('Rapier boundary: only src/core/world loads the physics engine', () => {
  it.each([
    "import RAPIER from '@dimforge/rapier3d-deterministic';",
    "import type { World } from '@dimforge/rapier3d-deterministic';",
    "import RAPIER from '@dimforge/rapier3d-deterministic-compat';",
    "import { RigidBody } from '@dimforge/rapier3d-deterministic/dynamics/rigid_body';",
  ])('rejects `%s` anywhere else in src', async (code) => {
    for (const filePath of outsideTheWorld) {
      expect(await boundaryViolations(code, filePath), filePath).toHaveLength(1);
    }
  });

  it.each([
    "export const load = () => import('@dimforge/rapier3d-deterministic');",
    "export const load = () => import('@dimforge/rapier3d-deterministic-compat');",
  ])('rejects the lazy `%s` anywhere else in src', async (code) => {
    for (const filePath of outsideTheWorld) {
      expect(await ruleViolations(code, filePath, 'no-restricted-syntax'), filePath).toHaveLength(1);
    }
  });

  it('allows static and lazy Rapier imports inside src/core/world', async () => {
    const code = [
      "import type { World } from '@dimforge/rapier3d-deterministic';",
      "export const load = (): Promise<World> => import('@dimforge/rapier3d-deterministic').then((R) => new R.World({ x: 0, y: 0, z: 0 }));",
    ].join('\n');
    expect(await boundaryViolations(code, 'src/core/world/rapier.ts')).toEqual([]);
    expect(await ruleViolations(code, 'src/core/world/rapier.ts', 'no-restricted-syntax')).toEqual([]);
    expect(await ruleViolations(code, 'src/core/world/sensors/example.test.ts', 'no-restricted-syntax')).toEqual([]);
  });
});

describe('world determinism (D-R12): src/core/world never uses an inexact Math function', () => {
  it.each([
    'export const f = (a: number) => Math.sin(a);',
    'export const f = (a: number) => Math.cos(a);',
    'export const f = (a: number) => Math.tan(a);',
    'export const f = (a: number, b: number) => Math.atan2(a, b);',
    'export const f = (a: number) => Math.exp(a);',
    'export const f = (a: number) => Math.log(a);',
    'export const f = (a: number, b: number) => Math.pow(a, b);',
    'export const f = (a: number, b: number) => Math.hypot(a, b);',
    'export const f = (a: number) => Math.acos(a);',
    'export const f = () => Math.random();',
    "export const f = (a: number) => Math['sin'](a);",
    'export const f = (a: number, b: number) => a ** b;',
    'export function f(a: number, b: number) { a **= b; return a; }',
    'const { sin } = Math; export const f = (a: number) => sin(a);',
  ])('rejects `%s`', async (code) => {
    expect(await ruleViolations(code, 'src/core/world/robot/example.ts', 'no-restricted-syntax')).toHaveLength(1);
  });

  it('allows + − × ÷ and Math.sqrt/abs/min/max/round/floor/ceil/imul, and Math constants', async () => {
    const code = [
      'export const f = (a: number, b: number) =>',
      '  Math.sqrt(a) + Math.abs(a) + Math.min(a, b) + Math.max(a, b) + Math.round(a) + Math.floor(a) + Math.ceil(b) +',
      '  Math.imul(a, b) + Math.PI * Math.SQRT1_2 - a / b;',
    ].join('\n');
    expect(await ruleViolations(code, 'src/core/world/robot/example.ts', 'no-restricted-syntax')).toEqual([]);
  });

  it('applies neither to tests of the world nor to code outside it', async () => {
    const code = 'export const f = (a: number) => Math.sin(a) + 2 ** a;';
    expect(await ruleViolations(code, 'src/core/world/dmath.test.ts', 'no-restricted-syntax')).toEqual([]);
    expect(await ruleViolations(code, 'src/core/run/example.ts', 'no-restricted-syntax')).toEqual([]);
    expect(await ruleViolations(code, 'src/ui/robot3d/example.ts', 'no-restricted-syntax')).toEqual([]);
  });
});
