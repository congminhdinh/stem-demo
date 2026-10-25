import { readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { colorReflectance } from '../../../core/world/arena/ground-paint';
import { scenarioCatalog } from '../../../samples/robot-scenarios';
import { en, vi } from '../../i18n/messages';
import { assetPath, readGlb } from '../__fixtures__/load-glb';
import type { PaintContext } from '../ground-paint';
import { checkpointNumbers, matTexts, paintMat } from './mat-paint';

// N18 R4.7: the mat the 3D view prints: the sensors' paint exactly (zones, then the tape on top of everything), each zone's border and
// name in shades of its own colour that a line sensor would still read as light, checkpoints numbered in the order the route visits
// them; and no vendor's name printed anywhere (plan D-R7): not in the mat's words, not in the modelled files' names.

const BRAND = /arduino|\buno\b|ohstem/i;

/** Records what is painted: each fill and stroke with its style, and each text. */
function recorder() {
  const calls: { op: string; style: string; text?: string }[] = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    fillRect() {
      calls.push({ op: 'fillRect', style: String(this.fillStyle) });
    },
    beginPath() {},
    moveTo() {},
    lineTo() {},
    closePath() {},
    arc() {},
    setLineDash() {},
    fill() {
      calls.push({ op: 'fill', style: String(this.fillStyle) });
    },
    stroke() {
      calls.push({ op: 'stroke', style: String(this.strokeStyle) });
    },
    fillText(text: string) {
      calls.push({ op: 'text', style: String(this.fillStyle), text });
    },
  };
  return { ctx: ctx as unknown as PaintContext & Pick<CanvasRenderingContext2D, 'arc' | 'setLineDash'>, calls };
}

const luma = (style: string) => {
  const match = /rgba?\((\d+), (\d+), (\d+)/.exec(style);
  if (match) return (0.2126 * Number(match[1]) + 0.7152 * Number(match[2]) + 0.0722 * Number(match[3])) / 255;
  return colorReflectance(style);
};

describe('the printed mat (N18 R4.7)', () => {
  it('numbers the checkpoints in the order the route visits them', () => {
    expect([...checkpointNumbers(scenarioCatalog.get('rb-square-route')!)]).toEqual([
      ['cp-1', 1],
      ['cp-2', 2],
      ['cp-3', 3],
      ['cp-4', 4],
    ]);
    expect([...checkpointNumbers(scenarioCatalog.get('rb-mini-mission')!)]).toEqual([
      ['cp-1', 1],
      ['cp-2', 2],
    ]);
    expect(checkpointNumbers(scenarioCatalog.get('rb-drive-to-zone')!).size).toBe(0);
  });

  it('paints the tape last, over every border and name, and prints nothing a line sensor would read as dark', () => {
    const scenario = scenarioCatalog.get('rb-mini-mission')!;
    const { ctx, calls } = recorder();
    paintMat(ctx, scenario, { pxPerCm: 2, labels: { zoneLabel: (zone) => zone.kind } });
    const tape = calls.findIndex((call) => call.op === 'stroke' && call.style === '#15171c');
    expect(tape).toBeGreaterThan(0);
    expect(calls.slice(tape).every((call) => call.op === 'stroke' && call.style === '#15171c')).toBe(true);
    const printed = calls.slice(0, tape).filter((call) => call.op !== 'fillRect' && !(call.op === 'fill' && scenario.arena.paint.zones.some((zone) => zone.color === call.style)));
    expect(printed.length).toBeGreaterThan(0);
    for (const call of printed) expect(luma(call.style)).toBeGreaterThan(0.5);
    expect(calls.filter((call) => call.op === 'text').map((call) => call.text)).toEqual(['start', '1', 'checkpoint', '2', 'checkpoint', 'target']);
  });

  it('prints no vendor’s name: the words of every pilot mat in both languages, and the names in the modelled files', () => {
    for (const words of [vi, en]) {
      const zoneLabel = (zone: { kind: string }) => (zone.kind === 'start' ? words['robot.zone.start'] : zone.kind === 'target' ? words['robot.zone.target'] : zone.kind === 'checkpoint' ? words['robot.zone.checkpoint'] : null);
      for (const scenario of scenarioCatalog.scenarios) {
        const texts = matTexts(scenario, { zoneLabel });
        for (const text of texts) expect(text).not.toMatch(BRAND);
      }
    }
    const files = readdirSync(assetPath('robot3d')).filter((name) => name.endsWith('.glb'));
    expect(files.length).toBe(4);
    for (const file of files) {
      const { json } = readGlb(assetPath(`robot3d/${file}`));
      const names = ['nodes', 'meshes', 'materials', 'images', 'textures'].flatMap((key) => ((json[key] as { name?: string }[] | undefined) ?? []).map((item) => item.name ?? ''));
      expect(names.length).toBeGreaterThan(20);
      for (const name of names) expect(name).not.toMatch(BRAND);
    }
  });
});
