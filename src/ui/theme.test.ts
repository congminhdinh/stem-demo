import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canvasPalette } from './canvas/colors';

// N6a S5: every colour of the chrome is a token of app.css, and every colour of the canvas is in colors.ts.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const colourLiteral = /#[0-9a-fA-F]{3,8}\b|rgba?\(/;

describe('theme (N6a S5)', () => {
  it('writes the chrome’s colours only as tokens on :root', () => {
    const css = read('./app/app.css');
    const root = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')) + 1);
    const outside = css.replace(root, '').split('\n').filter((line) => colourLiteral.test(line));
    expect(outside).toEqual([]);
    expect(root).toContain("--stem-font: 'Be Vietnam Pro'");
  });

  it('uses only tokens that :root defines', () => {
    const css = read('./app/app.css');
    const defined = new Set([...css.matchAll(/(--stem-[a-z-]+):/g)].map((match) => match[1]));
    const used = [...css.matchAll(/var\((--stem-[a-z-]+)\)/g)].map((match) => match[1]);
    expect(used.filter((token) => !defined.has(token))).toEqual([]);
  });

  it('draws the canvas only with the colours of colors.ts', () => {
    const canvasDir = new URL('./canvas/', import.meta.url);
    const renderers = readdirSync(canvasDir).filter((name) => name.endsWith('.tsx') && !name.includes('.test.'));
    const literals = renderers.flatMap((name) => read(`./canvas/${name}`).split('\n').filter((line) => colourLiteral.test(line)).map((line) => `${name}: ${line.trim()}`));
    expect(literals).toEqual([]);
    expect(canvasPalette.selection).toBe('#2680c2');
  });
});
