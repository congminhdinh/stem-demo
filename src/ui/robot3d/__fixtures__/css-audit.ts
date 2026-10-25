import { readFileSync } from 'node:fs';

// Reads the robot lab's style sheets for the tests of its accessibility (N18 R8): the design tokens of app.css `:root`, and every rule of a
// sheet with its declarations, the rules inside @media / @container / @supports flattened out (with the at-rule that holds them). Not a CSS
// parser: the sheets of this app are plain rules, comments, custom properties and at-rules, which is all it reads.

export type CssRule = {
  /** The selector list as written, whitespace folded. */
  selector: string;
  /** The at-rules that hold the rule, outermost first (`@media (prefers-reduced-motion: reduce)`). */
  within: readonly string[];
  /** The declarations, by property. A property declared twice keeps the last. */
  props: Readonly<Record<string, string>>;
};

const here = (path: string) => new URL(path, import.meta.url);

/** The text of `src/ui/<path>`. */
export const readUi = (path: string): string => readFileSync(here(`../../${path}`), 'utf8');

const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The index of the `}` that closes the `{` at `open`. */
function closing(css: string, open: number): number {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return i;
  }
  throw new SyntaxError('A rule is not closed.');
}

function declarations(body: string): Record<string, string> {
  const props: Record<string, string> = {};
  // A `;` inside parentheses (a data URL) does not end a declaration.
  let depth = 0;
  let start = 0;
  const flush = (end: number) => {
    const text = body.slice(start, end).trim();
    const colon = text.indexOf(':');
    if (colon > 0) props[text.slice(0, colon).trim()] = text.slice(colon + 1).trim();
  };
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '(') depth++;
    else if (body[i] === ')') depth--;
    else if (body[i] === ';' && depth === 0) {
      flush(i);
      start = i + 1;
    }
  }
  flush(body.length);
  return props;
}

/** Every style rule of `css`, flattened. */
export function readRules(css: string, within: readonly string[] = []): CssRule[] {
  const text = stripComments(css);
  const rules: CssRule[] = [];
  let at = 0;
  while (at < text.length) {
    const open = text.indexOf('{', at);
    if (open < 0) break;
    const close = closing(text, open);
    const head = text.slice(at, open).trim().replace(/\s+/g, ' ');
    const body = text.slice(open + 1, close);
    if (head.startsWith('@')) {
      if (/^@(media|container|supports|layer)\b/.test(head)) rules.push(...readRules(body, [...within, head]));
    } else {
      rules.push({ selector: head, within, props: declarations(body) });
    }
    at = close + 1;
  }
  return rules;
}

/** The design tokens of app.css `:root`, by name (`--stem-color-text`). */
export function readTokens(): Readonly<Record<string, string>> {
  const css = readUi('app/app.css');
  const root = readRules(css).find((rule) => rule.selector === ':root');
  if (!root) throw new Error('app.css has no :root rule.');
  return Object.fromEntries(Object.entries(root.props).filter(([name]) => name.startsWith('--stem-')));
}

/** `value` with every `var(--token)` replaced by the token's value. */
export function resolveTokens(value: string, tokens: Readonly<Record<string, string>>): string {
  return value.replace(/var\((--[a-z0-9-]+)\)/g, (_, name: string) => {
    const resolved = tokens[name];
    if (resolved === undefined) throw new Error(`The token ${name} is not defined on :root.`);
    return resolveTokens(resolved, tokens);
  });
}

/** The style sheets of the robot lab: its own, and the tabs and the tools that stand in it. */
export const robotSheets = ['robot3d/RobotLab.css', 'robot3d/RobotTools.css', 'robot3d/SensorOverlay.css', 'robot3d/CppTab.css', 'robot3d/PinInspector.css'] as const;
