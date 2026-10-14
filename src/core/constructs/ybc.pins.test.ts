import { describe, expect, it } from 'vitest';
import { evaluatePred, exposureViolations, isExposable, profileConstructViolations } from '../compat/contract-validation';
import { yolobitContract } from '../compat/yolobit-contract';
import ybcBoardJson from '../devices/definitions/ybc-board.json';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { buildToolbox, createBlockPackCatalog, createYbcPinsPack, ybcPinChoices } from '../program/block-packs';
import {
  ANALOG_MAX,
  PIN_LEVELS,
  PIN_NUMBERS,
  createPinBlockDefinitions,
  pinAnalogType,
  pinCapabilityOfBlock,
  pinConstructs,
  pinContractIds,
  pinNameOf,
  pinNumberOf,
  pinReadType,
  pinWriteType,
  pinsPackId,
} from './ybc.pins';

// The pin constructs against the frozen machine-readable contract (YB plan §6.2, §12): every pin block a
// profile shows is one of the three rows C-23, C-24, C-25; each passes the exposure gate; the domain written as
// constants in ybc.pins.ts is the contract's domain; and nothing the contract excludes (PWM, servo, pulse) is shown.

const contract = yolobitContract;
const registry = createDeviceRegistry(localDeviceDefinitions);
const packs = createBlockPackCatalog(registry);
const row = (id: string) => {
  const found = contract.constructs.find((construct) => construct.id === id);
  if (!found) {
    throw new Error(`No contract row ${id}`);
  }
  return found;
};
const domainOf = (id: string) => {
  const domain = row(id).domain;
  if (!domain) {
    throw new Error(`No domain for ${id}`);
  }
  return domain;
};
const profiles = ['ybc-basic', 'ybc-advanced'].map((id) => productionProfiles.get(id));

describe('the pin constructs are contract rows that pass the exposure gate', () => {
  it.each(pinConstructs.map((construct) => [construct.contractId, construct] as const))('%s', (id, construct) => {
    const found = row(id);
    expect(exposureViolations(found, contract)).toEqual([]);
    expect(isExposable(found, contract)).toBe(true);
    expect(found.eligibility).toBe('RESTRICTED');
    expect(found.profiles).toEqual(['ybc-basic', 'ybc-advanced']);
    expect(found.tier['ybc-basic']).toBe('MUST');
    expect(found.python?.form).toMatch(/pin<N>\./);
    // The module is `yolobit` (C-03b): the import and the preamble come from it.
    expect(found.modules).toEqual(['C-03b']);
    expect(construct.blockTypes.length).toBeGreaterThan(0);
  });

  it('are the rows C-23, C-24 and C-25, and no others', () => {
    expect(pinContractIds).toEqual(['C-23', 'C-24', 'C-25']);
    expect(row('C-23').capability).toBe('pin: digital write');
    expect(row('C-24').capability).toBe('pin: digital read');
    expect(row('C-25').capability).toBe('pin: analog read');
  });

  it('are listed by both profiles, which pass the gate with them', () => {
    for (const profile of profiles) {
      for (const id of pinContractIds) {
        expect(profile?.constructs, `${profile?.id}/${id}`).toContain(id);
      }
      expect(profileConstructViolations(profile?.id ?? '', profile?.constructs ?? [], contract)).toEqual([]);
      expect(profile?.blockPacks).toContain(pinsPackId);
    }
  });

  it('keep out what the contract excludes or leaves to a later phase: PWM / analog write, servo, pulse in, temperature', () => {
    for (const profile of profiles) {
      for (const id of ['C-26', 'C-27', 'C-28', 'C-16']) {
        expect(profile?.constructs, `${profile?.id}/${id}`).not.toContain(id);
      }
    }
    expect(row('C-26').eligibility).toBe('EXCLUDED');
    expect(row('C-28').eligibility).toBe('EXCLUDED');
    // Servo is a RESTRICTED row, but of the Advanced profile and of YB-7: no profile lists it at YB-4.
    expect(row('C-27').profiles).toEqual(['ybc-advanced']);
  });
});

describe('the constants are the contract\'s domain (C-23, C-24, C-25)', () => {
  const pins = [-1, 0, 1, 2, 3, 4, 20];

  it('C-23: the pin is one of P0..P2 and the value 0 or 1, at run time and at compile time', () => {
    for (const pin of pins) {
      for (const value of [-1, 0, 1, 2]) {
        const inContract = PIN_NUMBERS.includes(pin) && PIN_LEVELS.includes(value);
        expect(evaluatePred(domainOf('C-23').runtime, { values: { pin, value } }), `pin ${pin} value ${value}`).toBe(inContract);
        const compileTime = domainOf('C-23').compileTime.every((rule) => evaluatePred(rule.when, { values: { pin, value }, literals: new Set(['pin', 'value']) }));
        expect(compileTime, `pin ${pin} value ${value}`).toBe(inContract);
      }
    }
    expect(domainOf('C-23').compileTime.map((rule) => rule.diagnostic)).toEqual(['value-out-of-range', 'value-out-of-range']);
  });

  it('C-24: the pin is one of P0..P2', () => {
    for (const pin of pins) {
      expect(evaluatePred(domainOf('C-24').runtime, { values: { pin } }), `pin ${pin}`).toBe(PIN_NUMBERS.includes(pin));
    }
  });

  it('C-25: the pin is one of P0..P2 and the reading 0..4095 (the native scale, owner decision C-Q6 = A)', () => {
    expect(ANALOG_MAX).toBe(contract.analog.nativeMax);
    expect(ANALOG_MAX).toBe(4095);
    for (const pin of pins) {
      for (const raw of [-1, 0, 1, 2047, 4094, 4095, 4096, 1023, 1024]) {
        const inContract = PIN_NUMBERS.includes(pin) && raw >= 0 && raw <= ANALOG_MAX;
        expect(evaluatePred(domainOf('C-25').runtime, { values: { pin, raw } }), `pin ${pin} raw ${raw}`).toBe(inContract);
      }
    }
  });

  it('opens P0, P1 and P2 and nothing else: the contract\'s pins are the board\'s pins', () => {
    expect(PIN_NUMBERS).toEqual([0, 1, 2]);
    expect(PIN_NUMBERS.map(pinNameOf)).toEqual(ybcPinChoices(registry).digital);
    expect(ybcPinChoices(registry)).toEqual({ digital: ['P0', 'P1', 'P2'], analogIn: ['P0', 'P1', 'P2'] });
  });
});

describe('pin names', () => {
  it('are P<N>, with no sign, no leading zero, no case and no space', () => {
    expect(['P0', 'P1', 'P2', 'P3', 'P10', 'P20'].map(pinNumberOf)).toEqual([0, 1, 2, 3, 10, 20]);
    for (const bad of ['p1', 'P', 'P01', 'P-1', 'P1 ', ' P1', 'P1.5', 'PIN1', '', '1', 'P٣', 'P1\n']) {
      expect(pinNumberOf(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(pinNameOf(2)).toBe('P2');
  });
});

describe('the pins pack', () => {
  const pack = packs.get(pinsPackId);

  it('owns exactly the blocks of the three constructs, each block of one construct', () => {
    expect(pack?.family).toBe('ybc');
    expect([...(pack?.blockTypes ?? [])].sort()).toEqual([pinAnalogType, pinReadType, pinWriteType].sort());
    expect(pack?.blocks.map((definition) => definition.type).sort()).toEqual([pinAnalogType, pinReadType, pinWriteType].sort());
    const all = pinConstructs.flatMap((construct) => construct.blockTypes);
    expect(new Set(all).size).toBe(all.length);
    expect(pinCapabilityOfBlock.get(pinWriteType)).toBe('digital');
    expect(pinCapabilityOfBlock.get(pinReadType)).toBe('digital');
    expect(pinCapabilityOfBlock.get(pinAnalogType)).toBe('analogIn');
  });

  it('is in the toolbox of both profiles as the "Pins" category, with the three blocks and nothing else', () => {
    for (const profile of profiles) {
      const toolbox = buildToolbox(profile?.blockPacks ?? [], packs);
      const category = toolbox.contents.find((candidate) => candidate.name === 'Pins');
      expect(category?.contents).toEqual([
        { kind: 'block', type: pinWriteType },
        { kind: 'block', type: pinReadType },
        { kind: 'block', type: pinAnalogType },
      ]);
    }
  });

  it('is not part of a generic project: the generic toolbox and block set do not change (GB2)', () => {
    const generic = packs.typesOf(['generic.stem']);
    for (const type of [pinWriteType, pinReadType, pinAnalogType]) {
      expect(generic.has(type), type).toBe(false);
    }
    expect(JSON.stringify(buildToolbox(['generic.stem'], packs))).not.toContain('ybc_pin');
  });

  it('declares a read as a Boolean (fits if, while, not) and an analog read as a Number', () => {
    const definitions = Object.fromEntries((pack?.blocks ?? []).map((definition) => [definition.type, definition]));
    expect(definitions[pinReadType]?.output).toBe('Boolean');
    expect(definitions[pinAnalogType]?.output).toBe('Number');
    expect(definitions[pinWriteType]).toMatchObject({ previousStatement: null, nextStatement: null });
    expect(definitions[pinWriteType]?.output).toBeUndefined();
  });
});

describe('the pins a block offers come from the board\'s data', () => {
  const withBoard = (change: (board: typeof ybcBoardJson) => unknown) =>
    createDeviceRegistry([...localDeviceDefinitions.filter((definition) => (definition as { id: string }).id !== 'ybc-board'), change(structuredClone(ybcBoardJson))]);
  const optionsOf = (pack: ReturnType<typeof createYbcPinsPack>, type: string) =>
    ((pack.blocks.find((definition) => definition.type === type)?.args0 as { name: string; options?: string[][] }[]).find((arg) => arg.name === 'PIN')?.options ?? []).map(([name]) => name);

  it('leave out a reserved pin', () => {
    const reserved = withBoard((board) => ({ ...board, board: { ...board.board, reservedPins: ['P2'] } }));
    expect(ybcPinChoices(reserved)).toEqual({ digital: ['P0', 'P1'], analogIn: ['P0', 'P1'] });
    const pack = createYbcPinsPack(ybcPinChoices(reserved));
    expect([pinWriteType, pinReadType, pinAnalogType].map((type) => optionsOf(pack, type))).toEqual([['P0', 'P1'], ['P0', 'P1'], ['P0', 'P1']]);
  });

  it('offer a pin for analog read only when it has the capability, and for digital only when it has that', () => {
    const mixed = withBoard((board) => ({
      ...board,
      board: {
        ...board.board,
        pins: board.board.pins.map((pin) => (pin.name === 'P1' ? { ...pin, capabilities: ['digital'] } : pin.name === 'P2' ? { ...pin, capabilities: ['analogIn'] } : pin)),
      },
    }));
    expect(ybcPinChoices(mixed)).toEqual({ digital: ['P0', 'P1'], analogIn: ['P0', 'P2'] });
  });

  it('never offer a pin the contract does not open, whatever the data says', () => {
    const wide = withBoard((board) => ({
      ...board,
      board: { ...board.board, pins: [...board.board.pins, { name: 'P3', portId: 'p2', capabilities: ['digital', 'analogIn'] }, { name: 'P16', portId: 'p2' }] },
    }));
    const pack = createYbcPinsPack(ybcPinChoices(wide));
    expect(optionsOf(pack, pinWriteType)).toEqual(['P0', 'P1', 'P2']);
    expect(optionsOf(pack, pinAnalogType)).toEqual(['P0', 'P1', 'P2']);
  });

  it('stand in with the contract\'s pins when there is no board to ask, so the block can still be registered', () => {
    const none = createYbcPinsPack({ digital: [], analogIn: [] });
    expect(optionsOf(none, pinReadType)).toEqual(['P0', 'P1', 'P2']);
    expect(createPinBlockDefinitions({ digital: [], analogIn: [] })).toHaveLength(3);
  });
});
