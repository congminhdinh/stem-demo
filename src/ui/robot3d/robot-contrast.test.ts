import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, parseColor, type Rgba } from '../a11y/contrast';
import { readRules, readTokens, readUi, resolveTokens, robotSheets, type CssRule } from './__fixtures__/css-audit';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { robot3dColors } from './colors';
import { checkpointNumbers } from './parts/mat-paint';
import { tagBadgeColor } from './parts/zone-tags';
import { sensorColors } from './sensor-colors';
import { toolColors } from './tool-colors';

// N18 R8: the robot lab's colours against WCAG 2.2 AA (success criteria 1.4.3 text 4.5:1, 1.4.11 non-text 3:1), computed from the design
// tokens of app.css and the lab's style sheets, so that a new colour that fails is caught here and fixed in a token, not by a colour of one
// rule's own. A translucent surface (the cards that float over the 3D view are 97 % white) is judged at its worst: over pure black, which
// is darker than anything the view can show under it, so the result holds on both quality tiers and over the tape, the walls and the table.

const tokens = readTokens();
const token = (name: string) => `--stem-color-${name}`;
const colourOf = (name: string): Rgba => parseColor(resolveTokens(`var(${token(name)})`, tokens));
const BLACK: Rgba = [0, 0, 0, 1];
const WHITE: Rgba = [255, 255, 255, 1];

/** The opaque colour a token shows as: a translucent one over the darkest or the lightest thing that can be under it, whichever is worse. */
function worstRatio(foreground: Rgba | string, background: Rgba | string): number {
  const [fg, bg] = [typeof foreground === 'string' ? parseColor(foreground) : foreground, typeof background === 'string' ? parseColor(background) : background];
  return Math.min(
    ...[BLACK, WHITE].map((under) => {
      const [f, b] = [fg[3] === 1 ? fg : composite(fg, composite(bg, under)), composite(bg, under)];
      return contrastRatio(f, b);
    }),
  );
}
const tokenRatio = (fg: string, bg: string) => worstRatio(colourOf(fg), colourOf(bg));

/** What the lab puts text on when the rule that colours it has no background of its own: its three plain surfaces, the cards over the view. */
const plain = ['surface', 'surface-muted', 'overlay'];
const soft = ['neutral-soft', 'primary-soft', 'success-soft', 'danger-soft', 'warning-soft'];

/** The text colours the lab uses, each with every background it can stand on. A token missing here is a colour nobody has audited. */
const textOn: Readonly<Record<string, readonly string[]>> = {
  text: [...plain, ...soft],
  'text-muted': [...plain, ...soft],
  'neutral-text': [...plain, 'neutral-soft'],
  success: [...plain, 'success-soft'],
  danger: [...plain, 'danger-soft'],
  'warning-text': [...plain, 'warning-soft'],
  primary: [...plain, 'primary-soft'],
  'on-primary': ['primary', 'success'],
  'console-text': ['console-bg'],
  'text-subtle': ['console-bg'],
};

const sheets = robotSheets.map((path) => ({ path, rules: readRules(readUi(path)) }));
const tokenOf = (value: string | undefined): string | null => /^var\(--stem-color-([a-z-]+)\)$/.exec(value ?? '')?.[1] ?? null;
/** A control that is not available is exempt (WCAG 1.4.3, inactive user interface components). */
const inactive = (rule: CssRule) => /:disabled|\[aria-disabled=|\[disabled\]/.test(rule.selector);

describe('the design tokens against AA (N18 R8)', () => {
  it.each(Object.entries(textOn).flatMap(([text, backgrounds]) => backgrounds.map((background) => [text, background] as const)))('%s text on %s has at least 4.5:1', (text, background) => {
    expect(tokenRatio(text, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('judges a translucent surface at its worst: the cards over the 3D view hold the ratio over pure black', () => {
    // 97 % white over black is 247 grey: the muted text still has 4.5:1 on it.
    expect(composite(colourOf('overlay'), BLACK)[0]).toBeCloseTo(247.35, 2);
    expect(tokenRatio('text-muted', 'overlay')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('the lab’s style sheets (N18 R8)', () => {
  it('writes no colour of its own: every colour is a token of app.css', () => {
    for (const { path, rules } of sheets) {
      for (const rule of rules) {
        for (const [property, value] of Object.entries(rule.props)) {
          if (property.startsWith('--')) continue;
          expect(`${path} ${rule.selector} { ${property}: ${value} }`).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
        }
      }
    }
  });

  it('colours text only with tokens that were audited above, and every text and background pair of one rule has 4.5:1', () => {
    const pairs: string[] = [];
    for (const { path, rules } of sheets) {
      for (const rule of rules.filter((candidate) => !inactive(candidate))) {
        const foreground = tokenOf(rule.props.color);
        if (foreground === null) continue;
        expect(Object.keys(textOn), `${path} ${rule.selector} uses --stem-color-${foreground}`).toContain(foreground);
        const background = tokenOf(rule.props.background) ?? tokenOf(rule.props['background-color']);
        if (background === null) continue;
        pairs.push(`${path} ${rule.selector}: ${foreground} on ${background}`);
        expect(tokenRatio(foreground, background), `${path} ${rule.selector}: ${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // The audit read real pairs (the status chips, the selected buttons, the verdicts…).
    expect(pairs.length).toBeGreaterThan(15);
  });

  it('does not use the subtle text colour for text on a light surface (it has 2.3:1 there)', () => {
    for (const { path, rules } of sheets) {
      for (const rule of rules) {
        if (tokenOf(rule.props.color) === 'text-subtle') {
          expect(`${path} ${rule.selector}`).toBe('a text colour of at least 4.5:1');
        }
      }
    }
  });
});

describe('what the lab draws on the canvas (N18 R8)', () => {
  it('the zones’ tags: dark words on a white pill, over any mat', () => {
    expect(worstRatio(robot3dColors.tagText, robot3dColors.tagBackground)).toBeGreaterThanOrEqual(4.5);
  });

  it('a checkpoint’s number is white on a disc of the zone’s colour darkened until it has 4.5:1, for every pilot lesson’s zones and any colour', () => {
    let numbered = 0;
    for (const scenario of scenarioCatalog.scenarios) {
      const numbers = checkpointNumbers(scenario);
      for (const zone of scenario.arena.paint.zones.filter((candidate) => numbers.has(candidate.id))) {
        numbered++;
        expect(contrastRatio(robot3dColors.tagNumber, tagBadgeColor(zone.color, true)), `${scenario.key} ${zone.id}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(numbered).toBeGreaterThanOrEqual(6);
    for (const colour of ['#ffffff', '#fff2cc', '#d9ead3', '#cfe2f3', '#f2f2f2', '#ffff00', '#00ff00', '#ff0000', '#000000']) {
      expect(contrastRatio(robot3dColors.tagNumber, tagBadgeColor(colour, true)), colour).toBeGreaterThanOrEqual(4.5);
    }
    // It stays the zone's own hue (the disc says which zone it is), and a zone with no number keeps its lighter dot.
    expect(tagBadgeColor('#fff2cc', true)).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    expect(tagBadgeColor('#fff2cc', false)).toBe('rgb(209, 198, 167)');
  });

  it('the zones’ names on the 2D map and the fallback floor are opaque dark text on every pilot zone and ground, 4.5:1 or more', () => {
    const fills = new Set(scenarioCatalog.scenarios.flatMap((scenario) => [scenario.arena.ground.color, ...scenario.arena.paint.zones.map((zone) => zone.color)]));
    expect(fills.size).toBeGreaterThanOrEqual(4);
    for (const fill of fills) expect(contrastRatio(robot3dColors.zoneLabel, fill), fill).toBeGreaterThanOrEqual(4.5);
  });

  it('the distance tag and the ruler’s label read over any mat', () => {
    expect(worstRatio(sensorColors.labelText, sensorColors.labelBackground)).toBeGreaterThanOrEqual(4.5);
    expect(worstRatio(toolColors.labelText, toolColors.labelBackground)).toBeGreaterThanOrEqual(4.5);
  });

  it('the tags’ borders and lines, the ruler and the ghost are graphics that need 3:1 against the light mat', () => {
    const mat = '#f2f2f2';
    for (const [name, colour] of Object.entries({ sensorBorder: sensorColors.labelBorder, tagLine: robot3dColors.tagLine, ruler: toolColors.ruler, rulerEdge: toolColors.rulerEdge, ghostClear: toolColors.ghostClear, ghostBlocked: toolColors.ghostBlocked, ray: sensorColors.ray })) {
      expect(contrastRatio(colour, mat), name).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('the focus ring (N18 R8)', () => {
  it('has at least 3:1 against every surface it is drawn on (1.4.11, 2.4.11)', () => {
    for (const background of ['surface', 'surface-muted', 'bg', 'overlay', 'primary-soft', 'neutral-soft', 'warning-soft']) {
      expect(tokenRatio('primary', background), background).toBeGreaterThanOrEqual(3);
    }
    // The ring is a 3 px outline offset from the control, so it meets the page, not the control's own fill.
    expect(tokenRatio('primary', 'surface')).toBeGreaterThanOrEqual(4.5);
  });
});

/**
 * WCAG 1.4.11 for the lab's toggles: the cue that says a control is on or selected has at least 3:1 against what it is not (the off
 * control's own fill or border, or the panel it stands on). Each state is the indicator that changes, as tokens: a tint of the fill alone,
 * or a change of the icon's colour (the primary colour against the text colour is 2.3:1), is not enough, and where the rule has one of those
 * it has a ring or a bar as well. A state that is a shape (a cap that goes down) is a cue that is not a colour.
 */
type StateCue = { on: string; off: string; via: RegExp } | { shape: string };
const fill = /^background(-color)?$/;
const edge = /^(border(-bottom)?-color|box-shadow)$/;
const stateCues: Readonly<Record<string, StateCue>> = {
  // Fills (a button, a radio, a tool): the primary colour, against the card or the surface it stands on.
  ".robot-tool[aria-pressed='true']": { on: 'primary', off: 'overlay', via: fill },
  ".robot-pad-button[aria-pressed='true']": { on: 'primary', off: 'surface', via: fill },
  ".app-header .robot-speed [role='radio'][aria-checked='true']": { on: 'primary', off: 'surface', via: fill },
  ".robot-camera button[aria-pressed='true']": { on: 'primary', off: 'overlay', via: fill },
  // A bar under the control.
  ".robot-tool-action[aria-expanded='true']": { on: 'primary', off: 'overlay', via: edge },
  ".robot-program-tabs [role='tab'][aria-selected='true']": { on: 'primary', off: 'surface', via: edge },
  // A border or a ring: against the border it has when it is off, or the panel's.
  ".robot-header .robot-button[aria-pressed='true']": { on: 'warning-text', off: 'border-strong', via: edge },
  ".robot-hold-button[aria-pressed='true']": { on: 'text', off: 'border-strong', via: edge },
  ".robot-camera .robot-sensors-camera[aria-pressed='true']": { on: 'primary', off: 'overlay', via: edge },
  ".robot-sensors-panel[aria-pressed='true']": { on: 'primary', off: 'border', via: edge },
  // Not a colour.
  ".robot-hold-button[aria-pressed='true'] .robot-hold-cap": { shape: 'the cap goes down 3 px and loses its shadow' },
};

/** The icon-only controls: what identifies them is the icon (3:1), not their border (2.2:1 against the surface, which no control relies on). */
const iconControls: readonly { name: string; icon: string; on: string }[] = [
  { name: 'a tool of the strip', icon: 'text', on: 'overlay' },
  { name: 'an arrow of the pad', icon: 'primary', on: 'surface' },
  { name: 'the pad’s stop', icon: 'danger', on: 'surface' },
  { name: 'the pad’s fold', icon: 'text-muted', on: 'overlay' },
  { name: 'the sound button', icon: 'text', on: 'surface' },
  { name: 'a camera button and the reset', icon: 'text', on: 'overlay' },
  { name: 'the sensors panel', icon: 'text', on: 'overlay' },
];

describe('the on and off of every toggle, and what identifies a control (N18 R8, WCAG 1.4.11)', () => {
  it.each(Object.entries(stateCues).filter(([, cue]) => 'on' in cue))('%s shows its state with at least 3:1', (selector, cue) => {
    const { on, off, via } = cue as { on: string; off: string; via: RegExp };
    expect(tokenRatio(on, off)).toBeGreaterThanOrEqual(3);
    // The rule really paints that indicator (the fill, or the border or ring or bar) with that token: not only the icon's colour.
    const rule = sheets.flatMap(({ rules }) => rules).find((candidate) => candidate.selector === selector);
    expect(rule, `a rule for ${selector}`).toBeDefined();
    expect(Object.entries(rule!.props).some(([property, value]) => via.test(property) && value.includes(`var(--stem-color-${on})`)), `${selector} paints ${on} as ${via}`).toBe(true);
  });

  it('has every state rule of the lab’s sheets in the table above: a new toggle must be audited', () => {
    const found = sheets.flatMap(({ rules }) => rules.map((rule) => rule.selector)).filter((selector) => /\[aria-(pressed|checked|selected|expanded)='true'\]/.test(selector));
    expect(found.length).toBeGreaterThanOrEqual(Object.keys(stateCues).length);
    expect(found.filter((selector) => !(selector in stateCues))).toEqual([]);
    // And the table has no rule that is gone.
    expect(Object.keys(stateCues).filter((selector) => !found.includes(selector))).toEqual([]);
  });

  it.each(iconControls)('$name is identified by its icon at 3:1 or more', ({ icon, on }) => {
    expect(tokenRatio(icon, on)).toBeGreaterThanOrEqual(3);
  });

  it('records what the tint of a selected fill and the colour of an icon are on their own, which is why the rules above add a ring or a bar', () => {
    expect(tokenRatio('primary-soft', 'overlay')).toBeLessThan(1.3);
    expect(tokenRatio('primary', 'text')).toBeLessThan(3);
  });
});
