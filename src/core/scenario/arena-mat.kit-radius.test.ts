// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import lineFollow from '../../samples/robot-scenarios/rb-line-follow.json';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { productionKits, referenceKitRef } from '../hardware/catalog';
import { buildArenaMat, buildTiledSheet, matFootprintRadiusCm } from './arena-mat';
import { loadScenario } from './scenario';
import { kitFootprintRadiusCm } from './variants';

// N19 D1 (plan §7 D1, D-G8): the printed mat draws the floor the scenario's kit keeps clear at its start, `kitFootprintRadiusCm` of the
// kit: the start ring, the heading arrow up to it, the pose words beside it and the room the zone labels keep off it. The rover's is 11 cm,
// so a rover mat is the same text as before (n19-neutral.test.ts pins its bytes); a gripper reaches 16 cm and gets the larger ring.

const parse = (svg: string): XMLDocument => new DOMParser().parseFromString(svg, 'image/svg+xml');
const rover = productionKits.get(referenceKitRef)!;

describe('the printed mat’s start for the kit of the scenario', () => {
  it('reads the radius from the scenario’s kit: the rover’s 11 cm for every shipped rover scenario, 16 cm for the gripper lessons (N19 D4)', () => {
    for (const scenario of scenarioCatalog.scenarios) expect(matFootprintRadiusCm(scenario), scenario.key).toBe(scenario.kit === 'ref-uno-gripper' ? 16 : kitFootprintRadiusCm(rover));
    expect(kitFootprintRadiusCm(rover)).toBe(11);
    expect(scenarioCatalog.scenarios.filter((scenario) => scenario.kit === 'ref-uno-gripper').map((scenario) => scenario.key)).toEqual(['rb-grip-pick', 'rb-grip-deliver', 'rb-grip-sort', 'rb-grip-stack']);
  });

  // N19 D1–D3 fix round 2 (review M6): A2 registered ref-uno-gripper@0 (footprintRadiusCm 16), so a scenario on it gets the larger ring from its
  // kit, with no override: the same mat as the override gives.
  it('draws the 16 cm ring of a scenario whose kit is the gripper car, from the kit itself', () => {
    const gripper = { ...loadScenario(lineFollow), kit: 'ref-uno-gripper' };
    expect(matFootprintRadiusCm(gripper)).toBe(16);
    expect(matFootprintRadiusCm({ kit: 'ref-uno-gripper' })).toBe(16);
    const document = parse(buildArenaMat(gripper).svg);
    const ring = document.querySelector('#mat-start circle')!;
    expect([ring.getAttribute('cx'), ring.getAttribute('cy'), ring.getAttribute('r')]).toEqual(['50', '110', '16']);
    expect(Number(document.querySelector('#mat-start line.heading')!.getAttribute('x2'))).toBe(66);
    expect(document.querySelector('#mat-start text')!.getAttribute('y')).toBe('127.6');
    expect(buildArenaMat(gripper).svg).toBe(buildArenaMat(gripper, { footprintRadiusCm: 16 }).svg);
    expect(buildTiledSheet(gripper).html).toBe(buildTiledSheet(gripper, { footprintRadiusCm: 16 }).html);
  });

  it('refuses a kit the app has no file for: it cannot know how far that robot reaches', () => {
    expect(() => matFootprintRadiusCm({ kit: 'vendor-kit' })).toThrow('The robot kit "vendor-kit" is not one this app knows');
  });

  it('draws a 16 cm kit’s ring, arrow and pose words at 16 cm', () => {
    const scenario = loadScenario(lineFollow); // starts at x 50, y 30 of a 170 × 140 arena: the ring's middle is at sheet (50, 110)
    const document = parse(buildArenaMat(scenario, { footprintRadiusCm: 16 }).svg);
    const ring = document.querySelector('#mat-start circle')!;
    expect([ring.getAttribute('cx'), ring.getAttribute('cy'), ring.getAttribute('r')]).toEqual(['50', '110', '16']);
    expect(Number(document.querySelector('#mat-start line.heading')!.getAttribute('x2'))).toBe(66);
    // Below the ring, 1.6 cm past it, as for the rover's 11 (110 + 11 + 1.6 = 122.6)
    expect(document.querySelector('#mat-start text')!.getAttribute('y')).toBe('127.6');
    const roverDocument = parse(buildArenaMat(scenario).svg);
    expect(roverDocument.querySelector('#mat-start circle')!.getAttribute('r')).toBe('11');
    expect(roverDocument.querySelector('#mat-start text')!.getAttribute('y')).toBe('122.6');
  });

  it('keeps the zone labels off a 16 cm ring', () => {
    // One large start zone around the robot: its label would sit on the robot's middle, so it moves off the ring, as far as the kit reaches.
    const json = structuredClone(lineFollow) as unknown as Record<string, unknown>;
    json.key = 'rb-sandbox';
    json.goals = [];
    json.scoring = {};
    json.toolbox = undefined;
    json.arena = { ground: { sizeCm: [170, 140], color: '#f2f2f2' }, paint: { zones: [{ id: 'start', kind: 'start', polygonCm: [[20, 0], [80, 0], [80, 60], [20, 60]], color: '#cfe2f3' }] } };
    const scenario = loadScenario(json);
    const labelOf = (radiusCm?: number) => {
      const document = parse(buildArenaMat(scenario, radiusCm === undefined ? {} : { footprintRadiusCm: radiusCm }).svg);
      const id = document.querySelector('#label-zone-start .zone-id')!;
      const kind = document.querySelector('#label-zone-start .zone-kind')!;
      return { x: id.getAttribute('x'), idY: id.getAttribute('y'), kindY: kind.getAttribute('y'), size: id.getAttribute('font-size') };
    };
    const middleOf = (radiusCm?: number) => {
      const label = labelOf(radiusCm);
      const middleY = 140 - (Number(label.idY) + Number(label.kindY)) / 2;
      return Math.hypot(Number(label.x) - 50, middleY - 30);
    };
    // The rover's ring: the label's middle straight above the start, 15.9984 cm from it (sheet y 94.0016), clear of the 11.4 cm keep-off but
    // inside a 16 cm ring. With the 16 cm ring it moves aside to x 35.6288, 21.5 cm from the robot's middle.
    expect(labelOf()).toEqual({ x: '50', idY: '93.0656', kindY: '94.9376', size: '2.4' });
    expect(labelOf(16)).toEqual({ x: '35.6288', idY: '93.0656', kindY: '94.9376', size: '2.4' });
    expect(middleOf()).toBeCloseTo(15.9984, 4);
    expect(middleOf(16)).toBeCloseTo(Math.hypot(50 - 35.6288, 15.9984), 4);
    expect(middleOf()).toBeGreaterThan(11);
    expect(middleOf()).toBeLessThan(16);
    expect(middleOf(16)).toBeGreaterThan(16);
  });

  it('gives the A4 sheets the same radius', () => {
    const scenario = loadScenario(lineFollow);
    expect(buildTiledSheet(scenario, { footprintRadiusCm: 16 }).html).toContain('<g id="mat-start"><circle cx="50" cy="110" r="16" ');
    expect(buildTiledSheet(scenario).html).toBe(buildTiledSheet(scenario, { footprintRadiusCm: 11 }).html);
  });
});
