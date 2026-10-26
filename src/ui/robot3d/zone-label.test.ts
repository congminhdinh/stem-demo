import { describe, expect, it } from 'vitest';
import { zoneKinds, zoneNames, type PaintZone } from '../../core/world/arena/arena-schema';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { translate, type Locale } from '../i18n/messages';
import type { Text } from '../i18n/text';
import { zoneTags } from './parts/zone-tags';
import { zoneLabelOf } from './zone-label';

// N19 E5 (the E6/E7 gallery's hand-off): a zone the lesson names ("warehouse", "red"…) is called by that name on the mat, its tag in the 3D
// view and the 2D map, whatever its kind: "Kho", "Vùng thả", "Khu lấy hàng", "Vùng đỏ", "Vùng xanh lá", "Vùng xanh dương", "Vùng xếp".
// A zone without a name keeps its kind's word (N18: Xuất phát, Đích, Điểm kiểm tra; an area none).

const textOf = (locale: Locale): Text => (key, params) => translate(locale, key, params);
const zone = (kind: PaintZone['kind'], name?: PaintZone['name']): PaintZone => ({ id: `z-${kind}-${name ?? 'none'}`, kind, polygonCm: [[0, 0], [10, 0], [10, 10], [0, 10]], color: '#f4cccc', ...(name === undefined ? {} : { name }) });

const vi = { pickup: 'Khu lấy hàng', drop: 'Vùng thả', warehouse: 'Kho', red: 'Vùng đỏ', green: 'Vùng xanh lá', blue: 'Vùng xanh dương', stack: 'Vùng xếp' } as const;
const en = { pickup: 'Pickup area', drop: 'Drop zone', warehouse: 'Warehouse', red: 'Red zone', green: 'Green zone', blue: 'Blue zone', stack: 'Stacking zone' } as const;

describe('the words of a zone (N19 E5)', () => {
  it('names a named zone by its name, whatever its kind, in Vietnamese and in English', () => {
    expect(Object.keys(vi)).toEqual([...zoneNames]);
    for (const kind of zoneKinds) {
      for (const name of zoneNames) {
        expect(zoneLabelOf(textOf('vi'), zone(kind, name)), `${kind} ${name}`).toBe(vi[name]);
        expect(zoneLabelOf(textOf('en'), zone(kind, name)), `${kind} ${name}`).toBe(en[name]);
      }
    }
  });

  it('keeps the kind’s word for a zone without a name: the start, the target and a checkpoint; an area has none', () => {
    expect(zoneKinds.map((kind) => zoneLabelOf(textOf('vi'), zone(kind)))).toEqual(['Xuất phát', 'Đích', 'Điểm kiểm tra', null]);
    expect(zoneKinds.map((kind) => zoneLabelOf(textOf('en'), zone(kind)))).toEqual(['Start', 'Target', 'Checkpoint', null]);
  });
});

describe('the tags of named zones (N19 E5)', () => {
  it('tags every named zone, whatever its kind, with its name (a checkpoint’s number beside it), over the middle of its bounds', () => {
    const base = scenarioCatalog.get('rb-sandbox')!;
    const zones = zoneNames.map((name, i) => ({ ...zone(zoneKinds[i % zoneKinds.length]!, name), id: `zone-${name}`, polygonCm: [[20 * i, 0], [20 * i + 10, 0], [20 * i + 10, 8], [20 * i, 8]] as [number, number][] }));
    const scenario = { ...base, arena: { ...base.arena, paint: { ...base.arena.paint, zones } } };
    const tags = zoneTags(scenario, { zoneLabel: (candidate) => zoneLabelOf(textOf('vi'), candidate) });
    // The checkpoints among them keep their numbers in the route (paint order here) beside their names.
    const numbers: Partial<Record<(typeof zoneNames)[number], number>> = { warehouse: 1, stack: 2 };
    expect(tags.map(({ zoneId, text, number }) => [zoneId, text, number])).toEqual(zoneNames.map((name) => [`zone-${name}`, vi[name], numbers[name] ?? null]));
    expect(tags[2]!.centerCm).toEqual([45, 4]);
  });

  it('gives the rover’s lessons the very tags they had (none of their zones has a name)', () => {
    for (const scenario of scenarioCatalog.scenarios) {
      expect(scenario.arena.paint.zones.filter((candidate) => candidate.name !== undefined)).toEqual([]);
      const byKind = (candidate: PaintZone) => (candidate.kind === 'start' ? 'Xuất phát' : candidate.kind === 'target' ? 'Đích' : candidate.kind === 'checkpoint' ? 'Điểm kiểm tra' : null);
      expect(zoneTags(scenario, { zoneLabel: (candidate) => zoneLabelOf(textOf('vi'), candidate) })).toEqual(zoneTags(scenario, { zoneLabel: byKind }));
    }
  });
});
