import { describe, expect, it } from 'vitest';
import { composeCapabilities } from '../capabilities/compose';
import type { ModuleIO } from '../capabilities/io';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { unoDocument } from '../profiles/__fixtures__/uno-document';
import { resolveBoardContext } from '../profiles/board-context';
import { productionProfiles } from '../profiles';
import { kitBoardContext, kitBoardTarget, kitCapabilities } from './board-target';
import { kitRefOf, productionKits, unoR3Board as board } from './catalog';
import type { Kit } from './kit';

// N18 R1.2: what the compiler knows of a kit (plan §4.2): the roles present, the pins a raw op may use, the capabilities.

const rover = productionKits.get(kitRefOf({})) as Kit;
const moduleIO: ModuleIO = { call: () => {}, read: () => 0 };

describe('kitBoardTarget', () => {
  const target = kitBoardTarget(rover, board);

  it('names the kit, its board and every role of ref-uno-rover@0, in vocabulary order', () => {
    expect(target.kit).toEqual({ id: 'ref-uno-rover', version: '0' });
    expect(target.board).toBe('uno-r3');
    expect(target.roles).toEqual(['motorLeft', 'motorRight', 'ultrasonic', 'lineLeft', 'lineCenter', 'lineRight', 'servo1', 'led1', 'buzzer', 'button1']);
  });

  it('has the board’s capabilities plus modules', () => {
    expect(target.capabilities).toEqual(['digital', 'pwm', 'analogIn', 'modules']);
    expect(kitBoardTarget({ ...rover, ports: [], modules: [] }, board).capabilities).toEqual(['digital', 'pwm', 'analogIn']);
  });

  it('leaves no free PWM pin on ref-uno-rover@0 (contract §5.3): the free pins are D0, D1, A3, A4, A5', () => {
    expect(target.raw).toEqual({
      free: ['D0', 'D1', 'A3', 'A4', 'A5'],
      pwm: [],
      read: ['D3', 'D11', 'A0', 'A1', 'A2'],
      analogRead: ['A0', 'A1', 'A2'],
      serial: ['D0', 'D1'],
    });
    expect(target.pins).toEqual({ digital: ['D0', 'D1', 'A3', 'A4', 'A5'], analogIn: ['A0', 'A1', 'A2'], pwm: [], servo: [] });
    expect(target.usedBy).toMatchObject({ D5: 'M1', D9: 'SV1', D10: 'BZ1', A0: 'LN1' });
  });

  it('excludes from the free PWM pins every pin a port uses and every pin of a timer the kit’s servo or buzzer can claim', () => {
    const motorsOnly: Kit = { ...rover, ports: rover.ports.slice(0, 2), modules: rover.modules.slice(0, 2) };
    expect(kitBoardTarget(motorsOnly, board).raw.pwm).toEqual(['D3', 'D9', 'D10', 'D11']);
    const withServo: Kit = { ...motorsOnly, ports: [...motorsOnly.ports, ...rover.ports.filter((port) => port.id === 'SV1')], modules: [...motorsOnly.modules, ...rover.modules.filter((module) => module.role === 'servo1')] };
    expect(kitBoardTarget(withServo, board).raw.pwm).toEqual(['D3', 'D11']);
    expect(kitBoardTarget(withServo, board).claimers).toEqual(['servo']);
    expect(target.claimers).toEqual(['servo', 'tone']);
  });
});

describe('the modules capability reaches a uno project through its kit', () => {
  const registry = createDeviceRegistry(localDeviceDefinitions);
  const context = resolveBoardContext(unoDocument(), registry, productionProfiles);

  it('the board alone has no modules, so composeCapabilities would drop them', () => {
    expect(context.readiness.ok && context.readiness.capabilities).toEqual(['digital', 'pwm', 'analogIn']);
    expect(composeCapabilities(context.readiness.ok ? context.readiness.capabilities : [], { modules: moduleIO }).rejected).toEqual(['modules']);
  });

  it('the board with its kit has modules, and composeCapabilities keeps them', () => {
    const withKit = kitBoardContext(context, rover);
    expect(withKit.readiness.ok && withKit.readiness.capabilities).toEqual(['digital', 'pwm', 'analogIn', 'modules']);
    const composed = composeCapabilities(withKit.readiness.ok ? withKit.readiness.capabilities : [], { modules: moduleIO });
    expect(composed).toEqual({ capabilities: { modules: moduleIO }, rejected: [] });
    expect({ ...withKit, readiness: context.readiness }).toEqual(context);
  });

  it('adds modules once, only for a kit that has modules, and never to a board that is not ready', () => {
    expect(kitCapabilities(['digital', 'modules'], rover)).toEqual(['digital', 'modules']);
    expect(kitCapabilities(['digital'], { ...rover, modules: [] })).toEqual(['digital']);
    const notReady = resolveBoardContext(unoDocument('uno-basic', { circuit: { components: [], wires: [] } }), registry, productionProfiles);
    expect(kitBoardContext(notReady, rover)).toEqual(notReady);
  });
});
