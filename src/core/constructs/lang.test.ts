import { describe, expect, it } from 'vitest';
import { exposureViolations, isExposable, profileConstructViolations } from '../compat/contract-validation';
import { yolobitContract } from '../compat/yolobit-contract';
import type { FieldEntry } from '../compat/contract-types';
import { localDeviceDefinitions } from '../devices/local-catalog';
import { createDeviceRegistry } from '../devices/registry';
import { productionProfiles } from '../profiles';
import { buildToolbox, createBlockPackCatalog } from '../program/block-packs';
import { langConstructs, langContractIds, langPackIds } from './lang';
import { hardwareConstructs, hardwareContractIds } from './ybc';
import { pinConstructs, pinContractIds } from './ybc.pins';

// The YB-2a language constructs (and, since YB-4, the three header-pin rows) against the frozen
// machine-readable contract: every block a profile shows is a construct, every construct a contract
// row that passes the exposure gate, and nothing excluded, deferred or later-phase is shown.

const contract = yolobitContract;
const packs = createBlockPackCatalog(createDeviceRegistry(localDeviceDefinitions));
const profiles = ['ybc-basic', 'ybc-advanced'].map((id) => productionProfiles.get(id));

/**
 * Rows that must stay out of every profile until their own phase: random, elapsed time, events, PWM, the Advanced
 * display, temperature and servo (YB-7), text variables and functions. The onboard hardware of YB-3 (display C-06…C-09,
 * buttons C-12 and C-13, light C-15, sound C-50 and C-51) is shown and is tested in ybc.test.ts; C-23, C-24 and C-25 are
 * the header pins of YB-4.
 */
const notYet = [
  'C-40', 'C-19', 'C-14', 'C-26',
  'C-10', 'C-16', 'C-27', 'C-42', 'C-43',
  'C-57', 'C-58', 'C-59',
];

/** Every block type that appears in a toolbox, shadows and nested blocks included. */
function blockTypesIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => blockTypesIn(item, found));
  } else if (typeof value === 'object' && value !== null) {
    const record = value as Record<string, unknown>;
    if ((record.kind === 'block' || record.kind === undefined) && typeof record.type === 'string') {
      found.add(record.type);
    }
    Object.values(record).forEach((child) => blockTypesIn(child, found));
  }
  return found;
}

describe('YB-2a language constructs', () => {
  it.each(langConstructs.map((construct) => [construct.contractId, construct] as const))('%s is a contract row that passes the exposure gate', (id, construct) => {
    const row = contract.constructs.find((candidate) => candidate.id === id);
    expect(row, id).toBeDefined();
    expect(row && exposureViolations(row, contract)).toEqual([]);
    expect(row && isExposable(row, contract)).toBe(true);
    expect(row?.profiles).toEqual(['ybc-basic', 'ybc-advanced']);
    expect(construct.blockTypes.length).toBeGreaterThan(0);
  });

  it('is, with the YB-3 hardware and the header pins, exactly what both profiles list next to the structure (C-01, C-02), and passes the gate for each profile', () => {
    for (const profile of profiles) {
      expect([...(profile?.constructs ?? [])].sort()).toEqual(['C-01', 'C-02', ...langContractIds, ...hardwareContractIds, ...pinContractIds].sort());
      expect(profileConstructViolations(profile?.id ?? '', profile?.constructs ?? [], contract)).toEqual([]);
    }
  });

  it('keeps Advanced a superset of Basic, with no extra construct at YB-2a', () => {
    const [basic, advanced] = profiles;
    expect(advanced?.constructs).toEqual(basic?.constructs);
    expect(advanced?.blockPacks).toEqual(basic?.blockPacks);
  });

  it('exposes none of the rows that are excluded, deferred or belong to a later phase', () => {
    for (const profile of profiles) {
      for (const id of notYet) {
        expect(profile?.constructs, `${profile?.id}/${id}`).not.toContain(id);
      }
    }
    const rows = notYet.map((id) => contract.constructs.find((c) => c.id === id));
    expect(rows.every((row) => row !== undefined)).toBe(true);
  });

  it('owns every block type of a language pack through one construct, and each pack through its own constructs', () => {
    for (const id of langPackIds) {
      const pack = packs.get(id);
      const owned = langConstructs.filter((construct) => construct.pack === id).flatMap((construct) => construct.blockTypes);
      expect([...(pack?.blockTypes ?? [])].sort()).toEqual([...owned].sort());
    }
    const all = langConstructs.flatMap((construct) => construct.blockTypes);
    expect(new Set(all).size).toBe(all.length);
  });

  it('shows, in the Basic and Advanced toolboxes, only block types some construct owns (plus the hats)', () => {
    const owned = new Set([
      'stem_on_start',
      'stem_forever',
      ...langConstructs.flatMap((construct) => construct.blockTypes),
      ...hardwareConstructs.flatMap((construct) => construct.blockTypes),
      ...pinConstructs.flatMap((construct) => construct.blockTypes),
    ]);
    for (const profile of profiles) {
      const shown = blockTypesIn(buildToolbox(profile?.blockPacks ?? [], packs));
      expect([...shown].filter((type) => !owned.has(type))).toEqual([]);
      expect(shown.size).toBeGreaterThan(10);
    }
  });

  it('shows no random, hardware, change-by, function, until-loop, for-loop or generic block', () => {
    const forbidden = [
      'controls_whileUntil', 'controls_for', 'controls_forEach', 'controls_flow_statements', 'stem_wait', 'math_random_int', 'math_change',
      'stem_digital_write', 'stem_digital_read', 'procedures_defnoreturn', 'math_single', 'math_round',
    ];
    for (const profile of profiles) {
      const shown = blockTypesIn(buildToolbox(profile?.blockPacks ?? [], packs));
      for (const type of forbidden) {
        expect(shown.has(type), `${profile?.id}/${type}`).toBe(false);
      }
    }
  });

  it('offers + − × through ybc_arith, and not the built-in math_arithmetic (÷, power)', () => {
    const toolbox = JSON.stringify(buildToolbox(productionProfiles.get('ybc-basic')?.blockPacks ?? [], packs));
    for (const op of ['ADD', 'MINUS', 'MULTIPLY']) {
      expect(toolbox).toContain(`"OP":"${op}"`);
    }
    expect(toolbox).toContain('"type":"ybc_arith"');
    expect(toolbox).not.toContain('math_arithmetic');
    expect(toolbox).not.toMatch(/"OP":"(DIVIDE|POWER)"/);
  });

  describe('the gate keeps a construct out when its evidence is not enough', () => {
    const unsure = (label: 'UNKNOWN' | 'INFERRED'): FieldEntry => ({ label, note: 'not established' });
    const mutated = (id: string, field: keyof typeof contract.constructs[number]['fields'], entry: FieldEntry) => ({
      ...contract,
      constructs: contract.constructs.map((row) => (row.id === id ? { ...row, fields: { ...row.fields, [field]: entry } } : row)),
    });

    it.each(['UNKNOWN', 'INFERRED'] as const)('a profile cannot list a language construct with a required %s field', (label) => {
      for (const id of langContractIds) {
        const row = contract.constructs.find((candidate) => candidate.id === id);
        const field = (Object.entries(row?.fields ?? {}).find(([, entry]) => entry.label !== 'n/a')?.[0] ?? 'call') as 'call';
        const broken = mutated(id, field, unsure(label));
        expect(profileConstructViolations('ybc-basic', [id], broken), `${id}.${field}`).not.toEqual([]);
      }
    });

    it('a profile cannot list an excluded or deferred row', () => {
      for (const id of ['C-40', 'C-19', 'C-26', 'C-14']) {
        expect(profileConstructViolations('ybc-basic', [id], contract), id).not.toEqual([]);
      }
    });
  });
});
