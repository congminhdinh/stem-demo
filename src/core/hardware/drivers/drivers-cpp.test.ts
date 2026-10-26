import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { unoContract } from '../../compat/uno-contract';
import { productionKits, referenceKitRef, unoR3Board as board } from '../catalog';
import refUnoGripperJson from '../kits/ref-uno-gripper.kit.json';
import { loadKit } from '../kit-schema';
import type { Kit, KitPort } from '../kit';
import { allUses, driveCall, driveDirections, drivers, kitCpp, roleMacro, type Driver } from './index';

// N18 R1.4: each driver's `cpp` is the UNO contract's C++ (docs/uno-compatibility-contract.md §2.3, §6), checked against the
// contract's data, and snapshotted per driver for C1 (src/core/hardware/drivers/__golden__/<driver>.cpp).

const rover = productionKits.get(referenceKitRef) as Kit;
const row = (id: string) => {
  const found = unoContract.constructs.find((construct) => construct.id === id);
  if (!found?.cpp) {
    throw new Error(`No C++ form for ${id}`);
  }
  return found.cpp;
};

/** The argument placeholders of each row's form, in order. */
const placeholders: Record<string, string[]> = { 'U-20': ['<speed>'], 'U-23': ['<angle>'], 'U-24': ['<on>'], 'U-25': ['<hz>', '<ms>'] };

/** A contract text with the kit's role written in: `<ROLE>` → MOTOR_LEFT, `<role>` → motorLeft, `<LOW|HIGH>` by activeLow. */
function forRole(text: string, role: string, port: KitPort) {
  return text
    .replaceAll('<ROLE>', roleMacro(role))
    .replaceAll('<role>', role)
    .replaceAll('<LOW|HIGH>', port.params?.activeLow === true ? 'LOW' : 'HIGH');
}

/** The ports to check each driver on: the reference kit's, and an analog line port for the driver the kit does not use. */
const cases: { driver: Driver; port: KitPort; role: string }[] = [
  ...rover.modules.map((module) => {
    const port = rover.ports.find((candidate) => candidate.id === module.port) as KitPort;
    return { driver: drivers[port.driver], port, role: module.role };
  }),
  { driver: drivers['line-analog'], port: { id: 'LN9', driver: 'line-analog', pins: { PIN: 'A3' } }, role: 'lineCenter' },
  { driver: drivers['line-digital'], port: { id: 'LN8', driver: 'line-digital', pins: { PIN: 'A1' }, params: { activeLow: true } }, role: 'lineCenter' },
];

describe('every driver op writes its contract row’s C++ exactly', () => {
  it.each(cases.flatMap(({ driver, port, role }) => Object.entries(driver.ops).map(([op, driverOp]) => ({ name: `${driver.id} ${op} (${driverOp.row}) on ${port.id}`, driverOp, port, role }))))(
    '$name',
    ({ driverOp, port, role }) => {
      const contract = row(driverOp.row);
      expect(driverOp.cpp.call(port, role, placeholders[driverOp.row] ?? [])).toBe(forRole(contract.form, role, port));
      expect(driverOp.cpp.setup(port, role)).toEqual((contract.setup ?? []).map((line) => forRole(line, role, port)));
      expect(driverOp.cpp.globals(port, role)).toEqual((contract.globals ?? []).map((line) => forRole(line, role, port)));
      expect(driverOp.cpp.includes).toEqual(contract.includes);
      expect(driverOp.cpp.libraries).toEqual(contract.libraries);
      const helperIds = contract.helpers ?? [];
      expect(driverOp.cpp.helper).toEqual(helperIds.length === 0 ? null : { id: helperIds[0], text: unoContract.helpers[helperIds[0] ?? '']?.text });
      expect(helperIds.length).toBeLessThanOrEqual(1);
    },
  );

  // N19 A5: the gripper car's drivers on ref-uno-gripper@0's ports, against the rows U-35…U-39.
  const gripperKit = loadKit(refUnoGripperJson, board);
  const gripperPlaceholders: Record<string, string[]> = { 'U-35': ['<angle>'], 'U-36': ['<angle>'], 'U-38': ['<value>'], 'U-39': ['<value>'] };
  it.each(
    gripperKit.modules
      .filter((module) => ['gripper', 'irClaw', 'color1'].includes(module.role))
      .flatMap((module) => {
        const port = gripperKit.ports.find((candidate) => candidate.id === module.port) as KitPort;
        return Object.entries(drivers[port.driver].ops).map(([op, driverOp]) => ({ name: `${port.driver} ${op} (${driverOp.row}) on ${port.id}`, driverOp, port, role: module.role }));
      }),
  )('N19 A5: $name', ({ driverOp, port, role }) => {
    const contract = row(driverOp.row);
    expect(driverOp.cpp.call(port, role, gripperPlaceholders[driverOp.row] ?? [])).toBe(forRole(contract.form, role, port));
    expect(driverOp.cpp.setup(port, role)).toEqual((contract.setup ?? []).map((line) => forRole(line, role, port)));
    expect(driverOp.cpp.globals(port, role)).toEqual((contract.globals ?? []).map((line) => forRole(line, role, port)));
    expect(driverOp.cpp.includes).toEqual(contract.includes);
    expect(driverOp.cpp.libraries).toEqual(contract.libraries);
    const helperIds = contract.helpers ?? [];
    expect(driverOp.cpp.helper).toEqual(helperIds.length === 0 ? null : { id: helperIds[0], text: unoContract.helpers[helperIds[0] ?? '']?.text });
  });

  it('covers every module row of the contract: U-20, U-23…U-30 by a driver op, U-21 and U-22 by the drive', () => {
    const rows = new Set(Object.values(drivers).flatMap((driver) => Object.values(driver.ops).map((op) => op.row)));
    // N19 A3: and the gripper car's U-35…U-39, whose contract rows task A5 writes.
    expect([...rows].sort()).toEqual(['U-20', 'U-23', 'U-24', 'U-25', 'U-26', 'U-27', 'U-28', 'U-29', 'U-30', 'U-35', 'U-36', 'U-37', 'U-38', 'U-39']);
  });

  it('writes the drive as U-21 (one evaluation of the speed, neg32 for −s) and U-22', () => {
    const signs = { forward: ['_s', '_s'], backward: ['neg32(_s)', 'neg32(_s)'], spinLeft: ['neg32(_s)', '_s'], spinRight: ['_s', 'neg32(_s)'] } as const;
    for (const direction of driveDirections) {
      const [left, right] = signs[direction];
      const expected = row('U-21').form.replace('<speed>', '60L').replace('<_s|neg32(_s)>', left).replace('<_s|neg32(_s)>', right);
      expect(driveCall('drive.move', direction, '60L'), direction).toBe(expected);
    }
    expect(driveCall('drive.stop')).toBe(row('U-22').form);
  });

  it('declares its libraries: the core for every driver, and Servo 1.3.0 (LGPL-2.1) for servo-lib, as the contract pins them', () => {
    const core = { name: 'arduino:avr', version: unoContract.snapshot.core.version, license: unoContract.snapshot.core.license };
    const servo = unoContract.snapshot.libraries.find((library) => library.name === 'Servo');
    expect(drivers['servo-lib'].libraries).toEqual([core, { name: 'Servo', version: servo?.version, license: servo?.license }]);
    // N19 A3: gripper-servo2 (Servo) and tcs34725-wire (Wire) declare theirs too (gripper-drivers.test.ts).
    for (const driver of Object.values(drivers).filter((candidate) => !['servo-lib', 'gripper-servo2', 'tcs34725-wire'].includes(candidate.id))) {
      expect(driver.libraries, driver.id).toEqual([core]);
    }
  });
});

describe('the C++ of the reference kit, all ops used', () => {
  const sketch = readFileSync(join(process.cwd(), 'spikes/avr8js/sketches/contract-forms/contract-forms.ino'), 'utf8');
  // The sketch names the line pins LINE_LEFT…; the contract's U-28/U-29 forms write <ROLE>_PIN, so the drivers do too.
  const contractNames = (line: string) => line.replace(/\bLINE_(LEFT|CENTER|RIGHT)\b/g, 'LINE_$1_PIN');
  const cpp = kitCpp(rover, allUses(rover, board));

  it('sets up the ports in kit order, exactly as the contract sketch’s setup() after Serial.begin', () => {
    const setup = sketch.slice(sketch.indexOf('void setup() {')).split('\n').map((line) => line.trim());
    const lines = setup.slice(setup.indexOf('Serial.begin(9600);') + 1, setup.indexOf('DDRC |= _BV(PC4);'));
    expect(cpp.setup).toEqual(lines.map(contractNames));
  });

  it('defines every port pin as the sketch does', () => {
    const defines = sketch.split('\n').filter((line) => /^#define [A-Z0-9_]+ (\d+|A\d)$/.test(line));
    expect([...cpp.defines].sort()).toEqual(defines.map(contractNames).sort());
  });

  it('has the Servo include, the servo global and the helpers of the module rows, each once', () => {
    expect(cpp.includes).toEqual(['#include <Servo.h>']);
    expect(cpp.globals).toEqual(['Servo servo1;']);
    expect(cpp.helpers.map((helper) => helper.id)).toEqual(['hbridge-en-in1-in2', 'hcsr04-pulsein', 'servo-lib', 'buzzer-tone']);
    expect(cpp.libraries.map((library) => library.name)).toEqual(['arduino:avr', 'Servo']);
  });

  it('writes only what a program uses: an LED program has one define, one setup line and nothing else', () => {
    expect(kitCpp(rover, [{ role: 'led1', op: 'led.set' }])).toEqual({
      libraries: [{ name: 'arduino:avr', version: '1.8.8', license: 'LGPL-2.1' }],
      includes: [],
      defines: ['#define LED1_PIN 13'],
      globals: [],
      helpers: [],
      setup: ['pinMode(LED1_PIN, OUTPUT);'],
    });
  });
});

describe('driver C++ snapshots (C1 reuses them)', () => {
  /** Argument expressions as the generator writes literals (contract U-04), the values of the contract sketch. */
  const sampleArgs: Record<string, string[]> = {
    'motor.set': ['50L'],
    'servo.set': ['45L'],
    'led.set': ['true'],
    'buzzer.tone': ['440L', '100L'],
    'gripper.claw': ['80L'],
    'gripper.lift': ['0L'],
    'color.is': ['0L'],
    'color.raw': ['3L'],
  };
  /** N19 A3: the drivers the reference kit does not use, on the ports of ref-uno-gripper@0. */
  const gripper = loadKit(refUnoGripperJson, board);
  const snapshotCases = [
    ...cases,
    ...gripper.modules
      .map((module) => ({ module, port: gripper.ports.find((candidate) => candidate.id === module.port) as KitPort }))
      .filter(({ port }) => !cases.some((entry) => entry.driver === drivers[port.driver]))
      .map(({ module, port }) => ({ driver: drivers[port.driver], port, role: module.role })),
  ];

  /** One driver on one port, as the generator would write it: defines, includes, globals, helper, then each op's setup and call. */
  function render(driver: Driver, port: KitPort, role: string): string {
    const ops = Object.entries(driver.ops);
    const parts = [
      `// ${driver.id} on port ${port.id} as ${role}`,
      `// libraries: ${driver.libraries.map((library) => `${library.name}@${library.version} (${library.license})`).join(', ')}`,
      ...ops.flatMap(([, op]) => op.cpp.includes),
      ...driver.defines(port, role),
      ...ops.flatMap(([, op]) => op.cpp.globals(port, role)),
      ...ops.flatMap(([, op]) => (op.cpp.helper ? [op.cpp.helper.text] : [])),
      ...ops.flatMap(([name, op]) => [
        `// ${name} (${op.row}), ${op.kind}`,
        ...op.cpp.setup(port, role).map((line) => `//   setup: ${line}`),
        op.cpp.call(port, role, sampleArgs[name] ?? []),
      ]),
    ];
    return `${[...new Set(parts)].join('\n')}\n`;
  }

  it.each(Object.values(drivers).map((driver) => snapshotCases.find((entry) => entry.driver === driver) as (typeof cases)[number]))(
    '$driver.id',
    async ({ driver, port, role }) => {
      await expect(render(driver, port, role)).toMatchFileSnapshot(`./__golden__/${driver.id}.cpp`);
    },
  );
});
