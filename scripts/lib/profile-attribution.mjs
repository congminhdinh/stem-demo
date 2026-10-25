// N18 P2: where the main thread's time and the heap's allocations go, for scripts/bench-robot3d.mjs. It reads a V8 CPU profile (CDP
// Profiler.stop) or a sampling heap profile (HeapProfiler.stopSampling) of the production build, maps every frame back to its source
// through the build's hidden source maps (`vite build --sourcemap hidden`: the same bytes as a plain build, the maps beside them), and
// sums the samples:
//
//   by bucket  what a sample was doing, from its whole stack: the simulation (anything under src/core or Rapier: the run session's ticks,
//              the interpreter, the world), three's render (and within it the shadow map's), Blockly, React (react-dom: the HUD, the
//              panels), R3F's reconciler, the scene's frame callbacks (src/ui/robot3d under R3F's loop), garbage collection, the browser's
//              own work (style, layout, paint, GL calls: V8's "(program)"), idle
//   by source  the leaf's own source file (self time), for the top entries
//
// A small source-map reader (base64 VLQ, version 3), so that the script needs no dependency.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DIGIT = new Int8Array(128).fill(-1);
for (let i = 0; i < BASE64.length; i += 1) DIGIT[BASE64.charCodeAt(i)] = i;

/** A source map's `mappings`, decoded: per generated line, segments [column, source, line, column, name] (−1 where absent), by column. */
export function decodeMappings(mappings) {
  const lines = [];
  let line = [];
  let column = 0;
  let source = 0;
  let originalLine = 0;
  let originalColumn = 0;
  let name = 0;
  let i = 0;
  const fields = [];
  while (i < mappings.length) {
    const code = mappings.charCodeAt(i);
    if (code === 59 /* ; */) {
      lines.push(line);
      line = [];
      column = 0;
      i += 1;
      continue;
    }
    if (code === 44 /* , */) {
      i += 1;
      continue;
    }
    fields.length = 0;
    while (i < mappings.length) {
      const next = mappings.charCodeAt(i);
      if (next === 59 || next === 44) break;
      let value = 0;
      let shift = 0;
      let digit;
      do {
        digit = DIGIT[mappings.charCodeAt(i)];
        i += 1;
        if (digit < 0) throw new Error(`A source map's mappings hold a character that is not base64 at ${i - 1}.`);
        value += (digit & 31) * 2 ** shift;
        shift += 5;
      } while (digit & 32);
      fields.push(value % 2 === 1 ? -Math.floor(value / 2) : Math.floor(value / 2));
    }
    column += fields[0];
    if (fields.length >= 4) {
      source += fields[1];
      originalLine += fields[2];
      originalColumn += fields[3];
      if (fields.length >= 5) name += fields[4];
      line.push([column, source, originalLine, originalColumn, fields.length >= 5 ? name : -1]);
    } else {
      line.push([column, -1, -1, -1, -1]);
    }
  }
  lines.push(line);
  return lines;
}

/** A source map ready to look up: generated (line, column), 0-based, to the original source, line and its text. */
export function readSourceMap(map) {
  const lines = decodeMappings(map.mappings);
  const sources = map.sources.map((source) => source.replace(/^(\.\.\/)+/, '').replace(/^.*node_modules\/(\.pnpm\/[^/]+\/node_modules\/)?/, 'node_modules/'));
  const contentLines = new Map();
  const textOf = (sourceIndex, line) => {
    if (!map.sourcesContent?.[sourceIndex]) return '';
    let split = contentLines.get(sourceIndex);
    if (!split) {
      split = map.sourcesContent[sourceIndex].split('\n');
      contentLines.set(sourceIndex, split);
    }
    return split[line] ?? '';
  };
  const resolved = (segment) =>
    segment[1] < 0 ? null : { source: sources[segment[1]], line: segment[2], column: segment[3], name: segment[4] >= 0 ? map.names[segment[4]] : null, text: textOf(segment[1], segment[2]) };
  return {
    lookup(line, column) {
      const segments = lines[line];
      if (!segments || segments.length === 0) return null;
      let low = 0;
      let high = segments.length - 1;
      let found = -1;
      while (low <= high) {
        const middle = (low + high) >> 1;
        if (segments[middle][0] <= column) {
          found = middle;
          low = middle + 1;
        } else {
          high = middle - 1;
        }
      }
      if (found < 0) return null;
      return resolved(segments[found]);
    },
    /** As lookup, but a column before a line's first segment takes the last segment of the lines above (a function's start). */
    lookupNear(line, column) {
      const exact = this.lookup(line, column);
      if (exact) return exact;
      for (let above = line - 1; above >= 0 && above >= line - 50; above -= 1) {
        const segments = lines[above];
        if (segments && segments.length > 0) return resolved(segments[segments.length - 1]);
      }
      return null;
    },
  };
}

/** Every source map of a build's assets, by the asset's file name. */
export function loadSourceMaps(assetsDir) {
  const maps = new Map();
  for (const file of readdirSync(assetsDir)) {
    if (!file.endsWith('.js.map')) continue;
    maps.set(file.replace(/\.map$/, ''), readSourceMap(JSON.parse(readFileSync(join(assetsDir, file), 'utf8'))));
  }
  return maps;
}

/** What a source file is, for the tables. */
export function categoryOf(source) {
  if (source === null) return 'other';
  if (/^src\/core\/(program|codegen|constructs|simulation)\//.test(source)) return 'sim: interpreter';
  if (/^src\/core\/world\//.test(source)) return 'sim: world';
  if (/^src\/core\/run\//.test(source)) return 'sim: session';
  if (/^src\/core\/scenario\//.test(source)) return 'sim: scoring';
  if (/^src\/core\//.test(source)) return 'sim: core other';
  if (/@dimforge\/rapier/.test(source)) return 'sim: rapier glue';
  if (/node_modules\/three\//.test(source)) return 'three';
  if (/node_modules\/@react-three\/fiber\//.test(source)) return 'r3f';
  if (/node_modules\/react-dom\//.test(source)) return 'react-dom';
  if (/node_modules\/react-reconciler\//.test(source)) return 'react-reconciler';
  if (/node_modules\/(scheduler|react)\//.test(source)) return 'react';
  if (/node_modules\/blockly\//.test(source)) return 'blockly';
  if (/node_modules\/(zustand|use-sync-external-store)\//.test(source)) return 'state';
  if (/^src\/ui\/robot3d\//.test(source)) return 'ui: robot3d';
  if (/^src\/ui\/blockly\//.test(source)) return 'ui: blockly panel';
  if (/^src\/ui\//.test(source)) return 'ui: other';
  if (/^src\//.test(source)) return 'src other';
  return 'other';
}

/** The buckets, in the order a stack is given to the first that it holds. */
export const BUCKETS = ['gc', 'idle', 'browser', 'sim', 'shadow map', 'render', 'blockly', 'react-dom', 'r3f reconciler', 'scene callbacks', 'other js'];

const SPECIAL = new Map([
  ['(garbage collector)', 'gc'],
  ['(idle)', 'idle'],
  ['(program)', 'browser'],
]);

function frameResolver(maps) {
  const cache = new Map();
  return (callFrame) => {
    const key = `${callFrame.url}:${callFrame.lineNumber}:${callFrame.columnNumber}:${callFrame.url ? '' : callFrame.functionName}`;
    let resolved = cache.get(key);
    if (resolved) return resolved;
    const { url, functionName } = callFrame;
    if (!url) {
      // V8's own nodes (a leaf each, under the root): garbage collection, idle, and the browser's work outside JS. The root is none.
      const special = SPECIAL.get(functionName) ?? null;
      resolved = { native: true, special, source: null, category: special ?? 'native', text: '', name: functionName };
    } else if (/robot3d-probe\.js$/.test(url)) {
      // scripts/bench-robot3d.mjs's probe wraps WebGL's draw and bind calls and the canvas's getContext: its self time is those calls'.
      resolved = { native: false, special: null, source: 'WebGL calls (through the bench probe)', category: 'webgl calls', text: '', name: functionName };
    } else if (/^wasm:|\.wasm(\?|$)/.test(url)) {
      resolved = { native: false, special: null, source: 'rapier.wasm', category: 'sim: rapier wasm', text: '', name: functionName };
    } else {
      const file = url.replace(/[?#].*$/, '').split('/').pop();
      const map = maps.get(file);
      const original = map ? map.lookupNear(callFrame.lineNumber, callFrame.columnNumber) : null;
      const source = original?.source ?? (map ? null : `${file} (no map)`);
      resolved = { native: false, special: null, source, category: original ? categoryOf(original.source) : 'other', text: original?.text ?? '', name: original?.name ?? functionName };
    }
    cache.set(key, resolved);
    return resolved;
  };
}

/** The bucket a stack goes to: its frames' categories (root first) and whether one of them is three's render or its shadow map's. */
function bucketOf(flags) {
  if (flags.special) return flags.special;
  if (flags.sim) return 'sim';
  if (flags.shadow) return 'shadow map';
  if (flags.render) return 'render';
  if (flags.blockly) return 'blockly';
  if (flags.reactDom) return 'react-dom';
  if (flags.reconciler) return 'r3f reconciler';
  if (flags.scene) return 'scene callbacks';
  return 'other js';
}

function flagsOf(parent, frame) {
  const flags = { ...parent };
  if (frame.special) flags.special = frame.special;
  const category = frame.category;
  if (category.startsWith('sim')) flags.sim = true;
  if (category === 'three' && /\bthis\.render\s*=\s*function\s*\(\s*lights\b/.test(frame.text)) flags.shadow = true;
  else if (category === 'three' && /\bthis\.render\s*=\s*function\s*\(\s*scene\b/.test(frame.text)) flags.render = true;
  if (category === 'blockly' || category === 'ui: blockly panel') flags.blockly = true;
  if (category === 'react-dom' || category === 'react') flags.reactDom = true;
  if (category === 'react-reconciler') flags.reconciler = true;
  if (category === 'r3f' || category === 'ui: robot3d' || category === 'three') flags.scene = true;
  return flags;
}

/** Walks a profile tree (nodes with children ids): each node's resolved frame, its stack's flags and its leaf's source. */
function walk(nodes, resolve) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parentOf = new Map();
  for (const node of nodes) for (const child of node.children ?? []) parentOf.set(child, node.id);
  const info = new Map();
  const infoOf = (id) => {
    let known = info.get(id);
    if (known) return known;
    const node = byId.get(id);
    const frame = resolve(node.callFrame);
    const parentId = parentOf.get(id);
    const parent = parentId === undefined ? { flags: {}, sourceFrame: null } : infoOf(parentId);
    const flags = flagsOf(parent.flags, frame);
    // The leaf's source: its own, or the nearest caller's that has one (a native function a script calls is that script's time).
    const sourceFrame = frame.source ? frame : frame.special ? frame : parent.sourceFrame;
    known = { flags, bucket: bucketOf(flags), sourceFrame };
    info.set(id, known);
    return known;
  };
  return infoOf;
}

const sortedEntries = (record) => Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1]));

/**
 * A CPU profile's time by bucket and by leaf source (ms), and per animation frame when `frames` is given. The profile's samples cover
 * [startTime, endTime] µs; each sample is given the time to the next one.
 */
export function attributeCpuProfile(profile, maps, { frames = null, top = 18 } = {}) {
  const infoOf = walk(profile.nodes, frameResolver(maps));
  const buckets = Object.fromEntries(BUCKETS.map((bucket) => [bucket, 0]));
  const sources = {};
  const categories = {};
  const { samples, timeDeltas } = profile;
  let total = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const ms = (timeDeltas[i + 1] ?? timeDeltas[i] ?? 0) / 1000;
    const known = infoOf(samples[i]);
    buckets[known.bucket] = (buckets[known.bucket] ?? 0) + ms;
    const leaf = known.sourceFrame;
    const source = leaf ? (leaf.special ? `(${leaf.special})` : leaf.source) : '(unknown)';
    sources[source] = (sources[source] ?? 0) + ms;
    const category = leaf ? leaf.category : 'other';
    categories[category] = (categories[category] ?? 0) + ms;
    total += ms;
  }
  const busy = total - (buckets.idle ?? 0);
  const perFrame = frames ? Object.fromEntries(Object.entries(buckets).map(([bucket, ms]) => [bucket, ms / frames])) : null;
  return {
    totalMs: total,
    busyMs: busy,
    frames,
    bucketsMs: buckets,
    perFrameMs: perFrame,
    busyPerFrameMs: frames ? busy / frames : null,
    categoriesMs: sortedEntries(categories),
    topSourcesMs: Object.fromEntries(Object.entries(sortedEntries(sources)).slice(0, top)),
  };
}

/** A sampling heap profile's allocated bytes by bucket and by leaf source (collected objects included when the sampling asked for them). */
export function attributeHeapProfile(sampling, maps, { frames = null, top = 15 } = {}) {
  const nodes = [];
  const flatten = (node) => {
    nodes.push({ id: node.id, callFrame: node.callFrame, children: (node.children ?? []).map((child) => child.id), selfSize: node.selfSize });
    for (const child of node.children ?? []) flatten(child);
  };
  flatten(sampling.head);
  const infoOf = walk(nodes, frameResolver(maps));
  const buckets = {};
  const sources = {};
  let total = 0;
  for (const node of nodes) {
    if (!node.selfSize) continue;
    const known = infoOf(node.id);
    buckets[known.bucket] = (buckets[known.bucket] ?? 0) + node.selfSize;
    const source = known.sourceFrame?.source ?? '(unknown)';
    sources[source] = (sources[source] ?? 0) + node.selfSize;
    total += node.selfSize;
  }
  return {
    totalB: total,
    perFrameB: frames ? total / frames : null,
    bucketsB: sortedEntries(buckets),
    perFrameBucketsB: frames ? Object.fromEntries(Object.entries(sortedEntries(buckets)).map(([bucket, bytes]) => [bucket, bytes / frames])) : null,
    topSourcesB: Object.fromEntries(Object.entries(sortedEntries(sources)).slice(0, top)),
  };
}
