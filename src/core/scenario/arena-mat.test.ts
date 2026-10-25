// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import lineFollow from '../../samples/robot-scenarios/rb-line-follow.json';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import allGoals from './__fixtures__/all-goals.scenario.json';
import {
  A4_CM,
  MAT_DPI,
  SCALE_BAR_CM,
  TILE_MARGIN_CM,
  TILE_OVERLAP_CM,
  TILE_WINDOW_CM,
  buildArenaMat,
  buildMatLegend,
  buildTiledSheet,
  matPixelSize,
  matPixelsPerMetre,
  planTiles,
} from './arena-mat';
import { LINE_REFLECTANCE, colorReflectance, createGroundPaint } from '../world/arena/ground-paint';
import { loadScenario } from './scenario';
import { ROBOT_FOOTPRINT_RADIUS_CM } from './variants';

// N18 R5.3: the printable arena. The builder turns a validated scenario into SVG text in centimetres, so these tests read the SVG back with a
// real XML parser (jsdom) instead of matching strings, which also proves it is well-formed.

/** The text as XML: a document that is not well-formed has a `parsererror` and fails here. */
function parse(svg: string): XMLDocument {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const error = document.querySelector('parsererror');
  if (error) throw new Error(`not well-formed XML: ${error.textContent}`);
  return document;
}
const parseHtml = (html: string) => new DOMParser().parseFromString(html, 'text/html');
const numbers = (text: string | null) => (text ?? '').trim().split(/[\s,]+/).map(Number);
const pointsOf = (element: Element) => {
  const flat = numbers(element.getAttribute('points'));
  return Array.from({ length: flat.length / 2 }, (_, i) => [flat[2 * i]!, flat[2 * i + 1]!] as const);
};
const near = (actual: number, expected: number, digits = 3) => expect(actual).toBeCloseTo(expected, digits);

const lineScenario = () => loadScenario(lineFollow);
const fixtureScenario = () => loadScenario(allGoals);

describe('buildArenaMat', () => {
  it('is an SVG in physical units: width and height in cm and a viewBox in cm, exactly the ground', () => {
    const mat = buildArenaMat(lineScenario());
    expect(mat.widthCm).toBe(170);
    expect(mat.heightCm).toBe(140);
    const root = parse(mat.svg).documentElement;
    expect(root.tagName).toBe('svg');
    expect(root.getAttribute('width')).toBe('170cm');
    expect(root.getAttribute('height')).toBe('140cm');
    expect(root.getAttribute('viewBox')).toBe('0 0 170 140');
    const ground = root.querySelector('#mat-ground rect');
    expect([ground?.getAttribute('x'), ground?.getAttribute('y'), ground?.getAttribute('width'), ground?.getAttribute('height')]).toEqual(['0', '0', '170', '140']);
    expect(ground?.getAttribute('fill')).toBe('#f2f2f2');
  });

  it('draws the tape at its exact width with round caps and joins, the way ground-paint.ts samples it, and y up the sheet', () => {
    const scenario = lineScenario();
    const tape = parse(buildArenaMat(scenario).svg).querySelectorAll('#mat-tape > *');
    expect(tape).toHaveLength(scenario.arena.paint.lines.length);
    scenario.arena.paint.lines.forEach((line, i) => {
      const element = tape[i]!;
      expect(element.getAttribute('id')).toBe(`tape-${i}`);
      expect(Number(element.getAttribute('stroke-width'))).toBe(line.widthCm);
      expect(element.getAttribute('stroke')).toBe('#000000');
      expect(element.getAttribute('stroke-linecap')).toBe('round');
      expect(element.getAttribute('stroke-linejoin')).toBe('round');
      expect(element.getAttribute('fill')).toBe('none');
      // The arena has y away from the viewer; the sheet has y down: a point (x, y) is drawn at (x, depth - y)
      expect(pointsOf(element)).toEqual(line.pointsCm.map(([x, y]) => [x, 140 - y]));
    });
  });

  it('draws a one-point tape (a dot) as a disc of the tape width', () => {
    const json = structuredClone(allGoals) as typeof allGoals;
    json.arena.paint.lines.push({ pointsCm: [[100, 100], [100, 100]], widthCm: 4 });
    const dot = parse(buildArenaMat(loadScenario(json)).svg).querySelector('#tape-1');
    expect(dot?.tagName).toBe('circle');
    expect([dot?.getAttribute('cx'), dot?.getAttribute('cy'), dot?.getAttribute('r'), dot?.getAttribute('fill')]).toEqual(['100', '60', '2', '#000000']);
  });

  it('draws each zone as a filled, outlined polygon with its id, in the order of the arena (a later zone over an earlier one)', () => {
    const scenario = fixtureScenario();
    const document = parse(buildArenaMat(scenario).svg);
    const zones = document.querySelectorAll('#mat-zones > polygon');
    expect(Array.from(zones, (zone) => zone.getAttribute('id'))).toEqual(scenario.arena.paint.zones.map((zone) => `zone-${zone.id}`));
    scenario.arena.paint.zones.forEach((zone, i) => {
      const element = zones[i]!;
      expect(element.getAttribute('fill')).toBe(zone.color);
      expect(element.getAttribute('fill-rule')).toBe('evenodd');
      expect(element.getAttribute('data-kind')).toBe(zone.kind);
      expect(Number(element.getAttribute('stroke-width'))).toBeGreaterThan(0);
      expect(pointsOf(element)).toEqual(zone.polygonCm.map(([x, y]) => [x, 160 - y]));
    });
    // The label of a zone says its id, and a zone of the route says its place in it
    const labels = Array.from(document.querySelectorAll('#mat-zone-labels text'), (text) => text.textContent);
    expect(labels).toContain('start');
    expect(labels).toContain('dock');
    expect(labels).toContain('cp-a');
    expect(document.querySelector('#label-zone-cp-a .zone-kind')?.textContent).toBe('điểm kiểm tra 1');
    expect(document.querySelector('#label-zone-cp-b .zone-kind')?.textContent).toBe('điểm kiểm tra 2');
    expect(document.querySelector('#label-zone-dock .zone-kind')?.textContent).toBe('vùng đích (điểm 3)');
    expect(document.querySelector('#label-zone-gate .zone-kind')?.textContent).toBe('vùng');
    expect(document.querySelector('#label-zone-start .zone-kind')?.textContent).toBe('vùng xuất phát');
  });

  it.each(scenarioCatalog.scenarios.map((scenario) => [scenario.key, scenario] as const))(
    '%s: no zone label lies on the tape, under the robot at its start, or on the words that say where it starts',
    (_key, scenario) => {
      const depth = scenario.arena.ground.sizeCm[1];
      const document = parse(buildArenaMat(scenario).svg);
      const distanceToSegment = (px: number, py: number, [ax, ay]: readonly [number, number], [bx, by]: readonly [number, number]) => {
        const dx = bx - ax;
        const dy = by - ay;
        const t = dx === 0 && dy === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      };
      const pose = document.querySelector('#mat-start text')!;
      const poseY = Number(pose.getAttribute('y'));
      for (const zone of scenario.arena.paint.zones) {
        const id = document.querySelector(`#label-zone-${zone.id} .zone-id`)!;
        const kind = document.querySelector(`#label-zone-${zone.id} .zone-kind`)!;
        const x = Number(id.getAttribute('x'));
        // The middle of the two lines, in arena coordinates
        const middleY = depth - (Number(id.getAttribute('y')) + Number(kind.getAttribute('y'))) / 2;
        for (const line of scenario.arena.paint.lines) {
          for (let k = 1; k < line.pointsCm.length; k++) {
            expect(distanceToSegment(x, middleY, line.pointsCm[k - 1]!, line.pointsCm[k]!), `${zone.id} on the tape`).toBeGreaterThan(line.widthCm / 2);
          }
        }
        // Not under the robot (its footprint ring) ...
        expect(Math.hypot(x - scenario.start.xCm, middleY - scenario.start.yCm), `${zone.id} under the robot`).toBeGreaterThan(ROBOT_FOOTPRINT_RADIUS_CM);
        // ... and not on the pose words: the two boxes (the text's width is about 0.55 of its size per letter, 0.65 bold) do not meet
        const idSize = Number(id.getAttribute('font-size'));
        const kindSize = Number(kind.getAttribute('font-size'));
        const labelHalfWidth = Math.max(0.65 * idSize * id.textContent!.length, 0.55 * kindSize * kind.textContent!.length) / 2;
        const labelTop = Number(id.getAttribute('y')) - idSize;
        const labelBottom = Number(kind.getAttribute('y'));
        const poseHalfWidth = (pose.textContent!.length * 1.1 * 0.55) / 2;
        const apart =
          Math.abs(x - Number(pose.getAttribute('x'))) >= labelHalfWidth + poseHalfWidth || labelBottom <= poseY - 1.1 || labelTop >= poseY;
        expect(apart, `${zone.id} on the pose`).toBe(true);
      }
    },
  );

  it('draws the walls, boxes, cylinders and objects as footprints with a hatched outline, labelled tường or vật cản', () => {
    const scenario = fixtureScenario();
    const document = parse(buildArenaMat(scenario).svg);
    const footprints = document.querySelectorAll('#mat-obstacles > .footprint');
    expect(footprints).toHaveLength(4 + 2 + 1 + 1);

    // A wall: a rectangle along its centre line, its square ends thickness / 2 past both points (2 cm thick here)
    const top = document.querySelector('#wall-0');
    expect(top?.getAttribute('data-id')).toBeNull();
    expect(top?.getAttribute('fill')).toBe('url(#mat-hatch)');
    const topPoints = pointsOf(top!);
    const xs = topPoints.map(([x]) => x);
    const ys = topPoints.map(([, y]) => y);
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([-1, 201]);
    expect(ys.map((y) => 160 - y).sort((a, b) => a - b)).toEqual([0, 0, 2, 2]);

    // A box of 14 × 8 turned 15° about its centre (100, 25): the corners keep their distance from the centre
    const block = pointsOf(document.querySelector('#box-0')!);
    expect(block).toHaveLength(4);
    for (const [x, y] of block) near(Math.hypot(x - 100, y - (160 - 25)), Math.hypot(7, 4));
    const [first, second] = block;
    near(Math.hypot(second![0] - first![0], second![1] - first![1]), 14);

    // A cylinder: a circle of its radius, at its centre
    const pole = document.querySelector('#cylinder-0');
    expect(pole?.getAttribute('data-id')).toBe('pole');
    expect([pole?.tagName, pole?.getAttribute('cx'), pole?.getAttribute('cy'), pole?.getAttribute('r')]).toEqual(['circle', '100', '20', '3']);
    expect(document.querySelector('#object-0')?.getAttribute('class')).toContain('footprint');

    const labels = Array.from(document.querySelectorAll('#mat-labels text'), (text) => text.textContent ?? '');
    expect(labels.filter((label) => label.startsWith('tường'))).toHaveLength(4);
    expect(labels.filter((label) => label.startsWith('vật cản'))).toHaveLength(3);
    expect(labels).toContain('vật cản · block');
    expect(labels).toContain('vật đẩy · crate');
  });

  it('marks where the robot starts: its footprint circle, a heading arrow and the pose', () => {
    const scenario = lineScenario();
    const document = parse(buildArenaMat(scenario).svg);
    const ring = document.querySelector('#mat-start circle');
    expect([ring?.getAttribute('cx'), ring?.getAttribute('cy'), Number(ring?.getAttribute('r'))]).toEqual(['50', '110', ROBOT_FOOTPRINT_RADIUS_CM]);
    const arrow = document.querySelector('#mat-start line.heading');
    // yaw 0 points along +x, to the right of the sheet
    near(Number(arrow?.getAttribute('x2')), 50 + ROBOT_FOOTPRINT_RADIUS_CM);
    near(Number(arrow?.getAttribute('y2')), 110);
    expect(document.querySelector('#mat-start text')?.textContent).toBe('xuất phát · x 50, y 30 cm · 0°');
  });

  it('turns the heading with the yaw, counter-clockwise on the sheet', () => {
    const json = structuredClone(lineFollow) as typeof lineFollow;
    json.start.yawDeg = 90;
    const arrow = parse(buildArenaMat(loadScenario(json)).svg).querySelector('#mat-start line.heading');
    near(Number(arrow?.getAttribute('x2')), 50);
    // +y of the arena is up the sheet, so a robot facing +y points to smaller sheet y
    near(Number(arrow?.getAttribute('y2')), 110 - ROBOT_FOOTPRINT_RADIUS_CM);
  });

  it('escapes text and carries the title and the print scale as the SVG title and description', () => {
    const json = structuredClone(lineFollow) as typeof lineFollow;
    json.title.vi = 'Chạy <nhanh> & "chậm"';
    const mat = buildArenaMat(loadScenario(json));
    const root = parse(mat.svg).documentElement;
    expect(root.querySelector('title')?.textContent).toBe('Chạy <nhanh> & "chậm" (rb-line-follow@1)');
    expect(root.querySelector('desc')?.textContent).toContain('170 × 140 cm');
    expect(root.querySelector('desc')?.textContent).toContain('In 100 %');
  });

  it('is deterministic: the same scenario gives the same text', () => {
    expect(buildArenaMat(fixtureScenario()).svg).toBe(buildArenaMat(fixtureScenario()).svg);
  });

  it('needs nothing but the scenario: no wall, no paint, no goal', () => {
    const json = structuredClone(allGoals) as unknown as Record<string, unknown>;
    json.key = 'rb-sandbox';
    json.goals = [];
    json.scoring = {};
    json.toolbox = undefined;
    json.arena = { ground: { sizeCm: [50, 40], color: '#ffffff' } };
    json.start = { xCm: 25, yCm: 20, yawDeg: 0 };
    const mat = buildArenaMat(loadScenario(json));
    const document = parse(mat.svg);
    expect(mat.svg).toContain('viewBox="0 0 50 40"');
    expect(document.querySelectorAll('#mat-zones > *, #mat-tape > *, #mat-obstacles > *')).toHaveLength(0);
  });
});

describe('the SVG draws what the simulator reads', () => {
  it.each(scenarioCatalog.scenarios.map((scenario) => [scenario.key, scenario] as const))(
    '%s: at 20 000 spread points, the reflectance ground-paint.ts gives is the one the SVG shows (tape 0, the last zone over the point, the ground)',
    (_key, scenario) => {
      const [width, depth] = scenario.arena.ground.sizeCm;
      const document = parse(buildArenaMat(scenario).svg);
      const paint = createGroundPaint(scenario.arena);
      // Back to the arena's frame (y away from the viewer) from the sheet's (y down)
      const arenaPoints = (element: Element) => pointsOf(element).map(([x, y]) => [x, depth - y] as const);
      const tape = Array.from(document.querySelectorAll('#mat-tape > polyline'), (element) => ({ points: arenaPoints(element), half: Number(element.getAttribute('stroke-width')) / 2 }));
      const zones = Array.from(document.querySelectorAll('#mat-zones > polygon'), (element) => ({ points: arenaPoints(element), reflectance: colorReflectance(element.getAttribute('fill')!) }));
      const ground = colorReflectance(document.querySelector('#mat-ground rect')!.getAttribute('fill')!);
      expect(tape.length + document.querySelectorAll('#mat-tape > circle').length).toBe(scenario.arena.paint.lines.length);

      const distanceToSegment = (px: number, py: number, [ax, ay]: readonly [number, number], [bx, by]: readonly [number, number]) => {
        const dx = bx - ax;
        const dy = by - ay;
        const t = dx === 0 && dy === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      };
      // Even-odd, as the sensor reads a zone
      const inside = (points: readonly (readonly [number, number])[], px: number, py: number) => {
        let result = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [xi, yi] = points[i]!;
          const [xj, yj] = points[j]!;
          if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) result = !result;
        }
        return result;
      };
      const shown = (x: number, y: number) => {
        if (tape.some(({ points, half }) => points.some((point, i) => i > 0 && distanceToSegment(x, y, points[i - 1]!, point) <= half))) return LINE_REFLECTANCE;
        for (let i = zones.length - 1; i >= 0; i--) {
          if (inside(zones[i]!.points, x, y)) return zones[i]!.reflectance;
        }
        return ground;
      };

      // 20 000 points of the R2 low-discrepancy sequence (the plastic number's fractions), spread over the whole arena with no pattern that an edge
      // of a shape could line up with, as a grid at whole centimetres does along a 45° tape
      const mismatches: string[] = [];
      let onTape = 0;
      for (let i = 1; i <= 20_000; i++) {
        const x = width * ((i * 0.7548776662466927) % 1);
        const y = depth * ((i * 0.5698402909980532) % 1);
        const seen = shown(x, y);
        if (seen === LINE_REFLECTANCE) onTape += 1;
        if (Math.abs(paint.groundReflectanceAt(x, y, 0) - seen) > 1e-9) mismatches.push(`(${x.toFixed(3)}, ${y.toFixed(3)})`);
      }
      expect(mismatches.slice(0, 5)).toEqual([]);
      // The tape was really under some of the points (a scenario with tape), so that "no mismatch" is not "nothing compared"
      expect(onTape > 0).toBe(scenario.arena.paint.lines.length > 0);
    },
  );
});

describe('buildMatLegend', () => {
  it('has a scale bar of exactly 10 cm, ticked every centimetre, and the print instruction', () => {
    expect(SCALE_BAR_CM).toBe(10);
    const legend = buildMatLegend(lineScenario(), { xCm: 1, yCm: 28.3 });
    const wrapper = parse(`<svg xmlns="http://www.w3.org/2000/svg">${legend}</svg>`);
    const bar = wrapper.querySelector('.scale-bar');
    expect(Number(bar?.getAttribute('width'))).toBe(10);
    expect(wrapper.querySelectorAll('.scale-tick')).toHaveLength(11);
    const ticks = Array.from(wrapper.querySelectorAll('.scale-tick'), (tick) => Number(tick.getAttribute('x1')));
    expect(ticks[10]! - ticks[0]!).toBe(10);
    const texts = Array.from(wrapper.querySelectorAll('text'), (text) => text.textContent);
    expect(texts).toContain('In 100 %, không co giãn');
    expect(texts).toContain('10 cm');
    expect(texts).toContain('Bám theo vạch kẻ');
    expect(texts).toContain('rb-line-follow@1');
  });

  it('shortens a title that does not fit its strip, never wraps it', () => {
    const json = structuredClone(lineFollow) as typeof lineFollow;
    json.title.vi = 'Một tiêu đề rất dài '.repeat(5).trim();
    const legend = buildMatLegend(loadScenario(json), { xCm: 1, yCm: 28.3 });
    const title = parse(`<svg xmlns="http://www.w3.org/2000/svg">${legend}</svg>`).querySelector('.legend-title')?.textContent ?? '';
    expect(title.length).toBeLessThanOrEqual(40);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('print size', () => {
  it('is 150 dpi: the pixels of the true-scale PNG, and the 5906 px/m its pHYs chunk says', () => {
    expect(MAT_DPI).toBe(150);
    expect(matPixelsPerMetre()).toBe(5906);
    // 170 cm = 66.929 in = 10039.4 px; 140 cm = 55.118 in = 8267.7 px
    expect(matPixelSize(170, 140)).toEqual({ width: 10039, height: 8268 });
    expect(matPixelSize(2.54, 2.54)).toEqual({ width: 150, height: 150 });
    expect(matPixelSize(10, 10, 300)).toEqual({ width: 1181, height: 1181 });
  });
});

describe('planTiles', () => {
  it('prints a mat that fits one window on one sheet', () => {
    const plan = planTiles(18, 25);
    expect(plan).toMatchObject({ cols: 1, rows: 1 });
    expect(plan.tiles).toEqual([{ row: 0, col: 0, x0Cm: 0, y0Cm: 0 }]);
  });

  it('A4 portrait, a window of 18.6 × 26.7 cm (1.2 cm margin, 1.8 cm at the foot for the legend), 1 cm overlap', () => {
    expect(A4_CM).toEqual({ width: 21, height: 29.7 });
    expect(TILE_WINDOW_CM).toEqual({ width: 18.6, height: 26.7 });
    expect(TILE_MARGIN_CM.left + TILE_WINDOW_CM.width + TILE_MARGIN_CM.right).toBeCloseTo(A4_CM.width, 9);
    expect(TILE_MARGIN_CM.top + TILE_WINDOW_CM.height + TILE_MARGIN_CM.bottom).toBeCloseTo(A4_CM.height, 9);
    expect(TILE_OVERLAP_CM).toBe(1);
  });

  it('steps by the window less the overlap, and a row or column more only when the arena still has an uncovered strip', () => {
    // 18.6 + 17.6 = 36.2: two windows cover 36.2 cm exactly, 36.3 needs a third
    expect(planTiles(36.2, 26.7)).toMatchObject({ cols: 2, rows: 1 });
    expect(planTiles(36.3, 26.7)).toMatchObject({ cols: 3, rows: 1 });
    expect(planTiles(18.6, 26.7 + 25.7)).toMatchObject({ cols: 1, rows: 2 });
    expect(planTiles(18.6, 52.5)).toMatchObject({ cols: 1, rows: 3 });
    expect(planTiles(160, 80)).toMatchObject({ cols: 10, rows: 4 });
    expect(planTiles(200, 150)).toMatchObject({ cols: 12, rows: 6 });
  });

  it('covers the whole arena with each neighbour overlapping 1 cm, reading order row by row from the top', () => {
    const plan = planTiles(160, 80);
    expect(plan.tiles).toHaveLength(40);
    expect(plan.tiles.slice(0, 3)).toEqual([
      { row: 0, col: 0, x0Cm: 0, y0Cm: 0 },
      { row: 0, col: 1, x0Cm: 17.6, y0Cm: 0 },
      { row: 0, col: 2, x0Cm: 35.2, y0Cm: 0 },
    ]);
    expect(plan.tiles[10]).toEqual({ row: 1, col: 0, x0Cm: 0, y0Cm: 25.7 });
    const last = plan.tiles.at(-1)!;
    expect(last.x0Cm + TILE_WINDOW_CM.width).toBeGreaterThanOrEqual(160);
    expect(last.y0Cm + TILE_WINDOW_CM.height).toBeGreaterThanOrEqual(80);
    for (const tile of plan.tiles.filter((t) => t.col > 0)) {
      const left = plan.tiles.find((t) => t.row === tile.row && t.col === tile.col - 1)!;
      near(left.x0Cm + TILE_WINDOW_CM.width - tile.x0Cm, TILE_OVERLAP_CM);
    }
  });
});

describe('buildTiledSheet', () => {
  const sheet = buildTiledSheet(lineScenario());

  it('is one A4 portrait page per tile, with the page size in the document', () => {
    expect(sheet.cols).toBe(10);
    expect(sheet.rows).toBe(6);
    expect(sheet.pages).toBe(60);
    expect(sheet.html).toContain('@page { size: 21cm 29.7cm; margin: 0; }');
    const document = parseHtml(sheet.html);
    expect(document.querySelectorAll('section.page')).toHaveLength(60);
  });

  it('labels every page with its row and column, and every page has four crop marks and four registration marks', () => {
    const document = parseHtml(sheet.html);
    const pages = document.querySelectorAll('section.page');
    expect(pages[0]!.querySelector('.page-label')?.textContent).toBe('hàng 1/6 · cột 1/10');
    expect(pages[11]!.querySelector('.page-label')?.textContent).toBe('hàng 2/6 · cột 2/10');
    expect(pages[59]!.querySelector('.page-label')?.textContent).toBe('hàng 6/6 · cột 10/10');
    for (const page of pages) {
      expect(page.querySelectorAll('.crop-mark')).toHaveLength(4);
      expect(page.querySelectorAll('.registration-mark')).toHaveLength(4);
    }
  });

  it('shows the same window of the mat at the same scale on every page: a viewBox of 18.6 × 26.7 cm in a box of the same size, in the sheet units (cm)', () => {
    const document = parseHtml(sheet.html);
    const windows = Array.from(document.querySelectorAll('section.page svg.window'));
    expect(windows).toHaveLength(60);
    const second = windows[1]!;
    expect([second.getAttribute('width'), second.getAttribute('height')]).toEqual(['18.6', '26.7']);
    expect(second.getAttribute('viewBox')).toBe('17.6 0 18.6 26.7');
    expect(windows[10]!.getAttribute('viewBox')).toBe('0 25.7 18.6 26.7');
    // The mat is defined once and used by every page
    expect(document.querySelectorAll('#mat')).toHaveLength(1);
    expect(document.querySelectorAll('section.page svg.window use[href="#mat"]')).toHaveLength(60);
  });

  it('carries the scale bar and the print instruction on every page, and the cut line of the arena edge', () => {
    const document = parseHtml(sheet.html);
    const pages = document.querySelectorAll('section.page');
    for (const page of pages) {
      expect(Number(page.querySelector('.scale-bar')?.getAttribute('width'))).toBe(10);
      expect(page.textContent).toContain('In 100 %, không co giãn');
    }
    // Only a window that shows an edge of the arena has the cut line: the corner pages do, one inside the mat does not
    expect(pages[0]!.querySelector('.cut-line')).not.toBeNull();
    expect(pages[59]!.querySelector('.cut-line')).not.toBeNull();
    expect(pages[11]!.querySelector('.cut-line')).toBeNull();
  });
});
