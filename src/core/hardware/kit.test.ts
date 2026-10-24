import { describe, expect, it } from 'vitest';
import { loadBoard } from './board-schema';
import { driverIds, moduleKinds, robotRoles, roleKinds, type Kit } from './kit';
import { loadKit } from './kit-schema';
import refUnoRoverJson from './kits/ref-uno-rover.kit.json';
import unoR3Json from './uno-r3.board.json';

// N18 R1.1 (robot plan §4.2): a kit is data, role → port → driver → pins, validated against its board.

const board = loadBoard(unoR3Json);
const kit = loadKit(refUnoRoverJson, board);

type RawKit = {
  board: string;
  ports: { id: string; driver: string; pins: Record<string, string>; params?: Record<string, unknown> }[];
  modules: { role: string; kind: string; port: string }[];
};

/** A copy of the reference kit's JSON to break. */
const raw = (): RawKit => structuredClone(refUnoRoverJson) as unknown as RawKit;
const port = (kit: RawKit, index: number) => kit.ports[index] ?? { id: '', driver: '', pins: {} };
const module = (kit: RawKit, index: number) => kit.modules[index] ?? { role: '', kind: '', port: '' };

function thrown(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Nothing was thrown');
}

describe('the vocabulary', () => {
  it('has the robot roles of plan §4.2, each of one module kind', () => {
    expect([...robotRoles]).toEqual(['motorLeft', 'motorRight', 'ultrasonic', 'lineLeft', 'lineCenter', 'lineRight', 'servo1', 'led1', 'buzzer', 'button1']);
    expect(roleKinds).toEqual({
      motorLeft: 'dc-motor', motorRight: 'dc-motor', ultrasonic: 'ultrasonic', lineLeft: 'line-sensor', lineCenter: 'line-sensor',
      lineRight: 'line-sensor', servo1: 'servo', led1: 'led', buzzer: 'buzzer', button1: 'button',
    });
    expect([...moduleKinds]).toEqual(['dc-motor', 'servo', 'ultrasonic', 'line-sensor', 'led', 'buzzer', 'button']);
    expect([...driverIds]).toEqual(['hbridge-en-in1-in2', 'servo-lib', 'hcsr04-pulsein', 'line-digital', 'line-analog', 'led-digital', 'buzzer-tone', 'button-pullup']);
  });
});

describe('ref-uno-rover@0', () => {
  const pinsOf = (role: string) => {
    const module = kit.modules.find((candidate) => candidate.role === role);
    return kit.ports.find((port) => port.id === module?.port)?.pins;
  };

  it('is for uno-r3 and has every role of the vocabulary', () => {
    expect(kit).toMatchObject({ id: 'ref-uno-rover', version: '0', board: 'uno-r3' });
    expect(kit.modules.map((module) => module.role)).toEqual([...robotRoles]);
  });

  it('wires the PLACEHOLDER pins of plan §4.2 verbatim', () => {
    expect(pinsOf('motorLeft')).toEqual({ EN: 'D5', IN1: 'D7', IN2: 'D8' });
    expect(pinsOf('motorRight')).toEqual({ EN: 'D6', IN1: 'D4', IN2: 'D2' });
    expect(pinsOf('ultrasonic')).toEqual({ TRIG: 'D12', ECHO: 'D11' });
    expect([pinsOf('lineLeft'), pinsOf('lineCenter'), pinsOf('lineRight')]).toEqual([{ PIN: 'A0' }, { PIN: 'A1' }, { PIN: 'A2' }]);
    expect(pinsOf('servo1')).toEqual({ PIN: 'D9' });
    expect(pinsOf('led1')).toEqual({ PIN: 'D13' });
    expect(pinsOf('buzzer')).toEqual({ PIN: 'D10' });
    expect(pinsOf('button1')).toEqual({ PIN: 'D3' });
    expect(kit.ports.find((port) => port.pins.PIN === 'D3')?.driver).toBe('button-pullup');
  });

  it('lists its ports in the order the contract sketch sets them up (motors, ultrasonic, line, LED, button, servo, buzzer)', () => {
    expect(kit.ports.map((port) => port.driver)).toEqual([
      'hbridge-en-in1-in2', 'hbridge-en-in1-in2', 'hcsr04-pulsein', 'line-digital', 'line-digital', 'line-digital', 'led-digital',
      'button-pullup', 'servo-lib', 'buzzer-tone',
    ]);
  });
});

describe('loadKit refuses a kit that does not fit, naming the path', () => {
  it('kit with unknown driver id is rejected', () => {
    const broken = raw();
    port(broken, 0).driver = 'l298n-magic';
    expect(thrown(() => loadKit(broken, board))).toMatch(/ports\.0\.driver/);
  });

  it('kit referencing pin not on board is rejected', () => {
    const broken = raw();
    port(broken, 0).pins.EN = 'D20';
    expect(thrown(() => loadKit(broken, board))).toMatch(/ports\.0\.pins\.EN: D20 is not a pin of uno-r3/);
  });

  it('rejects a role outside the vocabulary, and a kind that is not the role’s', () => {
    const unknownRole = raw();
    module(unknownRole, 0).role = 'motorFront';
    expect(thrown(() => loadKit(unknownRole, board))).toMatch(/modules\.0\.role/);
    const wrongKind = raw();
    module(wrongKind, 0).kind = 'led';
    expect(thrown(() => loadKit(wrongKind, board))).toMatch(/modules\.0\.kind/);
  });

  it('rejects a module kind the port’s driver does not drive, and a port that does not exist', () => {
    const swapped = raw();
    module(swapped, 0).port = 'LED1';
    const message = thrown(() => loadKit(swapped, board));
    expect(message).toMatch(/modules\.0\.port: port LED1 drives a led, not a dc-motor/);
    const missing = raw();
    module(missing, 0).port = 'M9';
    expect(thrown(() => loadKit(missing, board))).toMatch(/modules\.0\.port: no port M9/);
  });

  it('rejects a driver pin that is missing, unknown or on a pin without the capability it needs', () => {
    const missingPin = raw();
    delete port(missingPin, 0).pins.IN2;
    expect(thrown(() => loadKit(missingPin, board))).toMatch(/ports\.0\.pins\.IN2: hbridge-en-in1-in2 needs pin IN2/);
    const extraPin = raw();
    port(extraPin, 0).pins.BRAKE = 'D13';
    expect(thrown(() => loadKit(extraPin, board))).toMatch(/ports\.0\.pins\.BRAKE: hbridge-en-in1-in2 has no pin BRAKE/);
    const noPwm = raw();
    port(noPwm, 0).pins.EN = 'D7';
    expect(thrown(() => loadKit(noPwm, board))).toMatch(/ports\.0\.pins\.EN: D7 has no pwm/);
  });

  it('rejects duplicate ports and roles, two modules on one port, an unknown param and a kit for another board', () => {
    const twicePort = raw();
    port(twicePort, 1).id = 'M1';
    expect(thrown(() => loadKit(twicePort, board))).toMatch(/ports\.1\.id: port M1 is listed twice/);
    const twiceRole = raw();
    module(twiceRole, 1).role = 'motorLeft';
    expect(thrown(() => loadKit(twiceRole, board))).toMatch(/modules\.1\.role: role motorLeft is listed twice/);
    const sharedPort = raw();
    module(sharedPort, 1).port = 'M1';
    expect(thrown(() => loadKit(sharedPort, board))).toMatch(/modules\.1\.port: port M1 already holds motorLeft/);
    const badParam = raw();
    port(badParam, 3).params = { activeLow: 1, gain: 2 };
    const paramMessage = thrown(() => loadKit(badParam, board));
    expect(paramMessage).toMatch(/ports\.3\.params\.activeLow: must be a boolean/);
    expect(paramMessage).toMatch(/ports\.3\.params\.gain: line-digital has no param gain/);
    expect(thrown(() => loadKit({ ...raw(), board: 'mega2560' }, board))).toMatch(/board: the kit is for mega2560, not uno-r3/);
  });

  it('gives a typed Kit whose line ports carry activeLow', () => {
    const line: Kit['ports'][number] | undefined = kit.ports.find((port) => port.driver === 'line-digital');
    expect(line?.params).toEqual({ activeLow: false });
  });
});
