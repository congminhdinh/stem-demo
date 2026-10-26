// N19 B5 (spike, eslint-ignored): the sweeps behind gripper.stability.test.ts and ADR 0004 §10c, the gripper car in a physics world of its own
// (the B1/B2 harness, src/core/world/__fixtures__/gripper-scene.ts). Each test prints its rows; results.md has them with the machine and load.
//
//   pnpm exec vitest run --config spikes/n19-b56/vitest.config.ts
//   pnpm exec vitest run --config spikes/n19-b56/vitest.config.ts -t 'wall hits'
//
// Wall hits: ADR 0004 §4.2 scenario 5 at duty 128..255, lift 0/45/90°, empty, 15 g and 50 g gripped at u 3 (fingertips first) or u 4 (the
// cube 0.5 cm past them), the drive released (coast) on the contact as world.ts counts it (between the step and the grasp update).
import { beforeAll, it } from 'vitest';
import { BRAKE, COAST, backward, cube, forward, gripperScene, pick, seconds, wait, type GripperScene, type Script } from '../../src/core/world/__fixtures__/gripper-scene';
import { initPhysics, type Collider } from '../../src/core/world/rapier';
import { rotateVector } from '../../src/core/world/units';

beforeAll(() => initPhysics(), 30_000);
const out = (s: string) => (globalThis as { process?: { stdout: { write(s: string): void } } }).process!.stdout.write(`${s}\n`);
const DEG = Math.PI / 180;
const START = { xCm: 40, yCm: 50, yawDeg: 0 } as const;
const TIP0 = 4.5 + 5 * Math.cos(-40 * DEG);

function tools(scene: GripperScene) {
  let ground: Collider | null = null;
  scene.world.forEachCollider((c) => {
    if (scene.arena.infoOf(c)?.kind === 'ground') ground = c;
  });
  let caster: Collider | null = null;
  scene.world.forEachCollider((c) => {
    if (scene.robot.ownsCollider(c) && c.parent()?.handle === scene.robot.chassis.handle && c.shape.type === 0 && Math.abs(c.radius() - 0.0075) < 1e-6) caster = c;
  });
  const pitchDeg = () => Math.asin(rotateVector(scene.robot.chassis.rotation(), { x: 1, y: 0, z: 0 }).y) / DEG;
  const casterGapMm = () => {
    const contact = caster!.contactCollider(ground!, 0.05);
    return contact === null ? 50 : contact.distance * 1000;
  };
  const casterLoadN = () => {
    let impulse = 0;
    scene.world.contactPair(caster!, ground!, (manifold) => {
      for (let i = 0; i < manifold.numContacts(); i++) impulse += manifold.contactImpulse(i);
    });
    return impulse / scene.world.timestep;
  };
  const finite = () =>
    [...scene.robot.bodies, ...scene.grasp.objects.map((o) => o.body)].every((b) => {
      const t = b.translation();
      const q = b.rotation();
      const v = b.linvel();
      return [t.x, t.y, t.z, q.x, q.y, q.z, q.w, v.x, v.y, v.z].every(Number.isFinite);
    });
  return { pitchDeg, casterGapMm, casterLoadN, finite };
}

function touching(scene: GripperScene, wall: Collider): boolean {
  let touch = false;
  const held = scene.grasp.heldBody;
  scene.world.contactPairsWith(wall, (other) => {
    const parent = other.parent();
    if (!(scene.robot.ownsCollider(other) || (held !== null && parent?.handle === held.handle))) return;
    scene.world.contactPair(wall, other, (m) => {
      for (let i = 0; i < m.numContacts(); i++) if (m.contactImpulse(i) > 0 || m.contactDist(i) <= 0.0005) touch = true;
    });
  });
  return touch;
}

function wallOf(scene: GripperScene): Collider {
  let wall: Collider | null = null;
  scene.world.forEachCollider((c) => {
    if (scene.arena.infoOf(c)?.id === 'wall') wall = c;
  });
  return wall!;
}

it('brake', () => {
  for (const [lift, mode] of [[90, 'brake'], [45, 'brake'], [90, 'coast'], [45, 'coast']] as const) {
    const scene = gripperScene({ ground: { sizeCm: [300, 100], color: '#ffffff' }, objects: [cube('cube', [START.xCm + TIP0 + 3 + 8, START.yCm], 50)] }, START);
    const t = tools(scene);
    const script = (function* (): Script {
      yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
      scene.set({ liftDeg: lift });
      yield* wait(seconds(0.5));
      scene.drive(forward(255));
      yield* wait(seconds(1.5));
    })();
    for (let i = 0; ; i++) {
      const r = script.next();
      if (r.done) break;
      scene.step();
    }
    const v0 = scene.robot.chassis.linvel().x;
    const x0 = scene.robot.chassis.translation().x;
    scene.drive(mode === 'brake' ? BRAKE : COAST);
    let maxP = -99, minP = 99, maxGap = -99, minLoad = 99;
    for (let i = 0; i < seconds(1.5); i++) {
      scene.step();
      maxP = Math.max(maxP, t.pitchDeg());
      minP = Math.min(minP, t.pitchDeg());
      maxGap = Math.max(maxGap, t.casterGapMm());
      minLoad = Math.min(minLoad, t.casterLoadN());
    }
    out(`brake lift ${lift} ${mode}: v0 ${v0.toFixed(3)} stop ${((scene.robot.chassis.translation().x - x0) * 100).toFixed(2)} cm pitch ${minP.toFixed(3)}..${maxP.toFixed(3)} casterGap ${maxGap.toFixed(4)} mm minLoad ${minLoad.toFixed(3)} N held ${scene.grasp.heldId} finite ${t.finite()}`);
    scene.dispose();
  }
}, 120_000);

it('wall hits', () => {
  const rows: string[] = [];
  for (const duty of [128, 160, 200, 226, 255]) {
    for (const lift of [0, 45, 90]) {
      for (const [graspU, massG] of [[4, 15], [3, 15], [4, 50], [3, 50], [3, 0]] as const) {
        if (lift === 0 && massG > 0) continue;
        const wallX = START.xCm + TIP0 + graspU + 8 + 60;
        const scene = gripperScene({ ground: { sizeCm: [250, 100], color: '#ffffff' }, walls: [{ id: 'wall', fromCm: [wallX + 1, 10], toCm: [wallX + 1, 90] }], objects: massG === 0 ? [] : [cube('cube', [START.xCm + TIP0 + graspU + 8, START.yCm], massG)] }, START);
        const t = tools(scene);
        const wall = wallOf(scene);
        let impact = -1;
        let speed = 0;
        let armed = false;
        const log: { pitch: number; w: number }[] = [];
        let maxGap = 0, gapTicks = 0;
        let heldAtImpact: string | null = null;
        const script = (function* (): Script {
          if (massG > 0) yield* pick(scene, 'cube', { liftDeg: 0, u: graspU });
          scene.set({ liftDeg: lift, clawDeg: massG > 0 ? 80 : 0 });
          yield* wait(seconds(0.5));
          scene.drive(forward(duty));
          armed = true;
          for (;;) yield;
        })();
        for (let i = 0; i < seconds(14); i++) {
          script.next();
          if (armed && impact < 0) speed = Math.abs(scene.robot.chassis.linvel().x);
          scene.step(() => {
            if (armed && impact < 0 && touching(scene, wall)) { impact = scene.tick; heldAtImpact = scene.grasp.heldId; scene.drive(COAST); }
          });
          if (impact >= 0) {
            const w = scene.robot.chassis.angvel();
            log.push({ pitch: t.pitchDeg(), w: Math.hypot(w.x, w.y, w.z) });
            const g = t.casterGapMm(); maxGap = Math.max(maxGap, g); if (g > 0.1) gapTicks += 1;
            if (scene.tick > impact + seconds(1.5)) break;
          }
        }
        const final = log.at(-1)!.pitch;
        let settled = log.length;
        for (let i = log.length - 1; i >= 0; i--) { if (Math.abs(log[i]!.pitch - final) > 0.2 || log[i]!.w > 0.05) break; settled = i; }
        const maxP = Math.max(...log.map((l) => l.pitch));
        rows.push(`duty ${duty} lift ${lift} u ${graspU} ${massG} g: v ${speed.toFixed(3)} held ${heldAtImpact}->${scene.grasp.heldId} maxPitch ${maxP.toFixed(2)} final ${final.toFixed(2)} settle ${(settled / 120).toFixed(3)} s gap ${maxGap.toFixed(2)} mm ${gapTicks}t finite ${t.finite()}`);
        scene.dispose();
      }
    }
  }
  out(rows.join('\n'));
}, 600_000);

it('lift moves', () => {
  const rows: string[] = [];
  for (const massG of [0, 15, 50]) {
    const scene = gripperScene({ ground: { sizeCm: [300, 100], color: '#ffffff' }, objects: massG === 0 ? [] : [cube('cube', [START.xCm + TIP0 + 3 + 8, START.yCm], massG)] }, START);
    const t = tools(scene);
    const run1 = (s: Script, n: number) => { for (let i = 0; i < n; i++) { s.next(); scene.step(); } };
    if (massG > 0) run1(pick(scene, 'cube', { liftDeg: 0, u: 3 }), seconds(3));
    else { scene.set({ liftDeg: 0 }); run1(wait(seconds(0.5)), seconds(0.5)); }
    // lift to 90 first from 0
    for (const [from, to] of [[0, 90], [90, 0], [0, 90], [90, 40], [40, 90], [90, 45], [45, 0], [0, 45], [45, 90], [90, 60], [60, 0]] as const) {
      scene.set({ liftDeg: from });
      run1(wait(seconds(0.6)), seconds(0.6));
      scene.set({ liftDeg: to });
      let maxGap = 0, run = 0, longest = 0, maxP = -99, minP = 99;
      for (let i = 0; i < seconds(0.8); i++) {
        scene.step();
        const g = t.casterGapMm();
        maxGap = Math.max(maxGap, g);
        run = g > 0.1 ? run + 1 : 0;
        longest = Math.max(longest, run);
        maxP = Math.max(maxP, t.pitchDeg()); minP = Math.min(minP, t.pitchDeg());
      }
      rows.push(`${massG} g ${from}->${to}: casterGap ${maxGap.toFixed(3)} mm longest ${longest} ticks pitch ${minP.toFixed(2)}..${maxP.toFixed(2)} held ${scene.grasp.heldId} finite ${t.finite()}`);
    }
    scene.dispose();
  }
  out(rows.join('\n'));
}, 300_000);

it('start duty', () => {
  const rows: string[] = [];
  for (const [size, at, yaw] of [[[300, 300], [40, 50], 0], [[400, 400], [40, 50], 0], [[200, 100], [40, 50], 0], [[300, 300], [150, 150], 90], [[180, 150], [30, 75], 0]] as const) {
    for (const duty of [90, 100, 110, 120, 128]) {
      const start = { xCm: at[0], yCm: at[1], yawDeg: yaw };
      const dir = yaw === 0 ? [1, 0] : [0, 1];
      const scene = gripperScene({ ground: { sizeCm: [size[0], size[1]], color: '#ffffff' }, objects: [cube('cube', [at[0] + dir[0]! * (TIP0 + 3 + 8), at[1] + dir[1]! * (TIP0 + 3 + 8)], 50)] }, start);
      let moved = 0;
      let held: string | null = null;
      const script = (function* (): Script {
        yield* pick(scene, 'cube', { liftDeg: 0, u: 3 });
        scene.drive(BRAKE);
        yield* wait(seconds(0.5));
        const p0 = scene.robot.pose().position;
        scene.drive(forward(duty));
        yield* wait(seconds(0.5));
        const p1 = scene.robot.pose().position;
        moved = Math.hypot(p1.x - p0.x, p1.z - p0.z) * 100;
        held = scene.grasp.heldId;
        for (;;) yield;
      })();
      for (let i = 0; i < seconds(0.35 + 4 + 1.1 + 1); i++) { script.next(); scene.step(); }
      rows.push(`${size.join('x')} at ${at.join(',')} yaw ${yaw} duty ${duty}: ${moved.toFixed(3)} cm held ${held}`);
      scene.dispose();
    }
  }
  out(rows.join('\n'));
}, 300_000);

it('press', () => {
  const rows: string[] = [];
  for (const massG of [15, 50]) {
    for (const gripLift of [10, 15]) {
      const scene = gripperScene({ ground: { sizeCm: [200, 100], color: '#ffffff' }, objects: [cube('cube', [START.xCm + TIP0 + 3 + 8, START.yCm], massG)] }, START);
      const t = tools(scene);
      const object = scene.object('cube');
      const force = () => {
        const others: Collider[] = [];
        scene.world.contactPairsWith(object.collider, (other) => { if (!scene.gripper.ownsCollider(other)) others.push(other); });
        let impulse = 0;
        for (const other of others) scene.world.contactPair(object.collider, other, (m) => { for (let i = 0; i < m.numContacts(); i++) { const n = m.contactImpulse(i), a = m.contactTangentImpulseX(i), b = m.contactTangentImpulseY(i); impulse += Math.sqrt(n * n + a * a + b * b); } });
        return impulse / scene.world.timestep;
      };
      const tipX = 4.5 + 5 * Math.cos((gripLift - 40) * DEG);
      scene.set({ liftDeg: gripLift, clawDeg: 0 });
      for (let i = 0; i < seconds(0.35); i++) scene.step();
      scene.drive(forward(140));
      for (let i = 0; i < seconds(4) && object.body.translation().x * 100 - scene.robot.chassis.translation().x * 100 - tipX > 3.25; i++) scene.step();
      scene.drive(BRAKE);
      for (let i = 0; i < seconds(0.3); i++) scene.step();
      scene.set({ clawDeg: 80 });
      for (let i = 0; i < seconds(0.6); i++) scene.step();
      const heldBefore = scene.grasp.heldId;
      scene.set({ liftDeg: 0 });
      let peak = 0, maxP = 0, maxGap = 0;
      let stillHeld = true;
      let peakForceBetween = 0;
      for (let i = 0; i < seconds(2.5); i++) {
        scene.step(() => { peakForceBetween = Math.max(peakForceBetween, force()); });
        peak = Math.max(peak, force());
        maxP = Math.max(maxP, t.pitchDeg());
        maxGap = Math.max(maxGap, t.casterGapMm());
        stillHeld &&= scene.grasp.heldId === 'cube';
      }
      const lift0 = scene.gripper.liftDeg();
      scene.set({ liftDeg: 90 });
      for (let i = 0; i < seconds(1); i++) scene.step();
      rows.push(`${massG} g grip at ${gripLift}: held ${heldBefore} stillHeld ${stillHeld} peakForce ${peakForceBetween.toFixed(3)} N maxPitch ${maxP.toFixed(3)} casterGap ${maxGap.toFixed(2)} lift ${lift0.toFixed(3)} | raised: held ${scene.grasp.heldId} pitch ${t.pitchDeg().toFixed(3)} gap ${t.casterGapMm().toFixed(3)} load ${t.casterLoadN().toFixed(3)} finite ${t.finite()}`);
      scene.dispose();
    }
  }
  out(rows.join('\n'));
}, 300_000);
