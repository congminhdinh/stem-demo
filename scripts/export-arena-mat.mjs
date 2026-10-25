// Prints a robot arena at true scale, to make a real mat for a real robot (N18 R5.3). For each scenario it writes four files, from the one
// SVG that src/core/scenario/arena-mat.ts builds out of the scenario's own arena (the geometry the simulator drives on, never a copy):
//
//   <key>.svg      the arena in centimetres: width="<W>cm" height="<H>cm", viewBox "0 0 W H". The ground, the tape (its exact width, round
//                  joins and caps), the zones (fill, outline, label), the robot's start, and the walls, boxes, cylinders and objects as
//                  hatched footprints labelled "tường" / "vật cản". Nothing outside the arena: this is what goes to a print shop.
//   <key>.pdf      the same, one page that is exactly W × H cm (page.pdf of the installed Chromium), vector.
//   <key>-a4.pdf   the same on A4 portrait pages for printing at home: 1 cm overlap, crop and registration marks, "hàng/cột" on every page,
//                  and a legend at the foot with the title, key@version, a 10 cm scale bar and "In 100 %, không co giãn".
//   <key>.png      the same at 150 dpi (pHYs 5906 px/m): W × H cm is about 59.06 px per cm, 10039 × 8268 px for the 170 × 140 cm line-follow mat.
//
//   node scripts/export-arena-mat.mjs <rb-key|all> [--out <dir>]
//   pnpm export:arena-mat rb-line-follow
//   pnpm export:arena-mat all --out /tmp/mats
//
//   --out  the folder for the files (default ./arena-mat, which .gitignore leaves alone); it is made when it is not there
//   --print-cache-dir  print the directory Vite's dependency cache of this script is resolved to (its own, see below), and exit
//
// Exit codes: 0 done; 1 something could not be made (a scenario that does not validate, Chromium missing, a render that came out wrong);
// 2 a usage error (an unknown key or option, no key).
//
// How it works. The sources are TypeScript, so the script loads them as scripts/export-robot-manifest.mjs does: through Vite's SSR loader with
// the repo's vite.config.ts, with a cache of its own (node_modules/.vite-export-arena-mat, never the dev server's), then closes it. The scenarios
// are the app's own catalog (the same `loadScenario` schema the lab validates with). Rendering is the Chromium Playwright installed
// (`pnpm exec playwright install chromium`): the SVG goes to PDF with `page.pdf({ width, height, printBackground: true })`, so the page is
// the arena's size; the A4 file is `buildTiledSheet`'s HTML printed the same way.
//
// The PNG. It is made tile by tile, not by one full-page screenshot, so that its size depends on nothing a Chromium build accepts and the
// picture is never whole in memory (83 million pixels for the 170 × 140 cm mat, 106 million for 200 × 150, at 3 bytes each): the SVG is laid out
// once at its final pixel size (a whole number of pixels, `matPixelSize`), a 2048 × 2048 px window of the page is screenshotted at a time (the SVG
// is moved under it by whole pixels), and each row of tiles is decoded and stitched into a strip that scripts/lib/png.ts compresses and writes,
// with the pHYs chunk (5906 px/m). On Chromium 153 a full-page screenshot also works here, up to 30 000 px wide, and gives the same picture to
// within the anti-aliasing of diagonal tape, the dashed ring and the hatching (0.015 % of the pixels, not gathered along the seams; straight tape
// is 147.5 px in both for its 2.5 cm). Fonts: Be Vietnam Pro (@fontsource, already a dependency) is embedded in the pages, so that the Vietnamese labels look
// the same on every machine.
//
// The PDFs. Chromium sizes a page to whole device units after rounding (up to a point off), and Playwright reads a `cm` as 37.8 px, so each file's
// page boxes are set to the exact size afterwards (scripts/lib/pdf-page-box.ts: the content is exactly to scale, only the box around it was
// not) and read back from the file.

/* global document -- the page.evaluate callbacks below run in Chromium, not in Node */

import { Buffer } from 'node:buffer';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer, resolveConfig } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** A failure with the exit code it ends the script with. */
class Failure extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const messageOf = (error) => (error instanceof Error ? error.message : String(error));
const usage = 'Usage: node scripts/export-arena-mat.mjs <rb-key|all> [--out <dir>]';

/** The Vite config of the script's server: the repo's, with the server of a script (no HMR, no watcher) and a cache of its own (see the header). */
const viteOptions = {
  root,
  configFile: join(root, 'vite.config.ts'),
  appType: 'custom',
  logLevel: 'error',
  // `ws: false` as well as `hmr: false`: Vite 8 still opens its WebSocket server on port 24678 otherwise, which a dev server of the repo (or another run) holds
  server: { middlewareMode: true, hmr: false, ws: false, watch: null },
  cacheDir: join(root, 'node_modules', '.vite-export-arena-mat'),
  optimizeDeps: { noDiscovery: true, include: [] },
};

function parseArguments(args) {
  const options = { target: null, out: resolve('arena-mat'), printCacheDir: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--print-cache-dir') {
      options.printCacheDir = true;
    } else if (arg === '--out') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Failure(2, `--out needs a folder. ${usage}`);
      options.out = resolve(value);
      index += 1;
    } else if (arg.startsWith('--')) {
      throw new Failure(2, `Unknown option ${arg}. ${usage}`);
    } else if (options.target === null) {
      options.target = arg;
    } else {
      throw new Failure(2, `One scenario key (or "all") at a time, not ${options.target} and ${arg}. ${usage}`);
    }
  }
  if (options.target === null && !options.printCacheDir) throw new Failure(2, `Name a scenario (rb-line-follow) or "all". ${usage}`);
  return options;
}

// ---- Fonts ----

/** The Latin and Vietnamese subsets of Google's Be Vietnam Pro, as the pages' @font-face rules, embedded so that no page reads a file. */
function embeddedFontCss() {
  const folder = join(root, 'node_modules', '@fontsource', 'be-vietnam-pro', 'files');
  const ranges = {
    latin: 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD',
    vietnamese: 'U+0102-0103,U+0110-0111,U+0128-0129,U+0168-0169,U+01A0-01A1,U+01AF-01B0,U+0300-0301,U+0303-0304,U+0308-0309,U+0323,U+0329,U+1EA0-1EF9,U+20AB',
  };
  const rules = [];
  for (const [subset, range] of Object.entries(ranges)) {
    for (const weight of [400, 700]) {
      const file = join(folder, `be-vietnam-pro-${subset}-${weight}-normal.woff2`);
      if (!existsSync(file)) {
        process.stderr.write(`Warning: ${relative(root, file)} is missing, so the labels use the system font.\n`);
        return '';
      }
      rules.push(
        `@font-face { font-family: 'Be Vietnam Pro'; font-style: normal; font-weight: ${weight}; ` +
          `src: url(data:font/woff2;base64,${readFileSync(file).toString('base64')}) format('woff2'); unicode-range: ${range}; }`,
      );
    }
  }
  return rules.join('\n');
}

// ---- Rendering ----

const CHROMIUM_MISSING = 'Chromium is not installed for Playwright: run `pnpm exec playwright install chromium` and try again.';
/** The window of the page one screenshot takes of the PNG, in pixels each way. */
const TILE_PX = 2048;
const CM_PER_INCH = 2.54;
/** How far a PDF page may be from the size asked for, points, once its box is set (the box is written to a thousandth of a point). */
const MEDIA_BOX_TOLERANCE_PT = 0.005;

async function launchChromium() {
  try {
    return await chromium.launch();
  } catch (error) {
    throw new Failure(1, `${CHROMIUM_MISSING} (${messageOf(error).split('\n')[0]})`);
  }
}

/**
 * The page's fonts are loaded before anything is printed: the labels have letters that a fallback font would draw differently. A face is only
 * fetched when text needs it, so it is asked for with a word of each subset (Latin, and the Vietnamese letters) in both weights.
 */
async function fontsReady(page, fontCss) {
  if (fontCss === '') return;
  const loaded = await page.evaluate(async () => {
    const sample = 'Tường điểm xuất phát';
    await Promise.all([document.fonts.load("400 12px 'Be Vietnam Pro'", sample), document.fonts.load("700 12px 'Be Vietnam Pro'", sample)]);
    await document.fonts.ready;
    return document.fonts.check("400 12px 'Be Vietnam Pro'", sample) && document.fonts.check("700 12px 'Be Vietnam Pro'", sample);
  });
  if (!loaded) throw new Failure(1, 'The embedded font did not load.');
}

/**
 * Chromium's PDF page is a point off at most (it rounds the page to device units: scripts/lib/pdf-page-box.ts), so the box is set to the exact
 * size, then read back from the file: the page count and the size of every page are what the file says, not what was asked for.
 */
function exactPages(file, pdf, pages, expectedPages, widthCm, heightCm) {
  const widthPt = (widthCm / CM_PER_INCH) * 72;
  const heightPt = (heightCm / CM_PER_INCH) * 72;
  const fitted = pages.fitPageBoxes(pdf, widthPt, heightPt);
  const boxes = pages.mediaBoxesOf(fitted);
  if (boxes.length !== expectedPages) throw new Failure(1, `${file} has ${boxes.length} page(s), not the ${expectedPages} expected.`);
  for (const box of boxes) {
    if (Math.abs(box.width - widthPt) > MEDIA_BOX_TOLERANCE_PT || Math.abs(box.height - heightPt) > MEDIA_BOX_TOLERANCE_PT) {
      throw new Failure(1, `${file} has a page of ${box.width} × ${box.height} pt, not ${widthPt.toFixed(2)} × ${heightPt.toFixed(2)} pt (${widthCm} × ${heightCm} cm).`);
    }
  }
  return fitted;
}

/** One page that is exactly the arena's size, the SVG on it at 100 %. */
async function renderMatPdf(page, mat, fontCss) {
  const size = `${mat.widthCm}cm ${mat.heightCm}cm`;
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}\n@page { size: ${size}; margin: 0; }\n` +
      `html, body { margin: 0; padding: 0; } svg { display: block; }</style></head><body>${mat.svg}</body></html>`,
  );
  await fontsReady(page, fontCss);
  return page.pdf({ width: `${mat.widthCm}cm`, height: `${mat.heightCm}cm`, printBackground: true, preferCSSPageSize: true });
}

/** A4 portrait pages, as many as the tiles need. */
async function renderTiledPdf(page, sheet, fontCss) {
  await page.setContent(sheet.html);
  await fontsReady(page, fontCss);
  return page.pdf({ width: '21cm', height: '29.7cm', printBackground: true, preferCSSPageSize: true });
}

/**
 * The strips of the PNG, from the top: each is `rows` whole rows of RGB, `width` pixels wide (see the header). `png` is scripts/lib/png.ts;
 * the SVG is laid out at its pixel size and a TILE_PX window of the page is screenshotted, tile by tile, row by row of tiles.
 */
async function* pngStrips(page, mat, size, fontCss, png) {
  const { width, height } = size;
  // preserveAspectRatio="none": the pixels per centimetre are width / W across and height / H down, whatever the rounding to whole pixels did
  const svg = mat.svg.replace('<svg ', '<svg preserveAspectRatio="none" ');
  await page.setViewportSize({ width: TILE_PX, height: TILE_PX });
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>${fontCss}\n` +
      'html, body { margin: 0; padding: 0; background: #fff; overflow: hidden; }\n' +
      `#mat { position: absolute; left: 0; top: 0; width: ${width}px; height: ${height}px; }\n` +
      `#mat > svg { display: block; width: ${width}px; height: ${height}px; }</style></head><body><div id="mat">${svg}</div></body></html>`,
  );
  await fontsReady(page, fontCss);

  for (let top = 0; top < height; top += TILE_PX) {
    const rows = Math.min(TILE_PX, height - top);
    const strip = Buffer.alloc(width * rows * 3);
    for (let left = 0; left < width; left += TILE_PX) {
      const columns = Math.min(TILE_PX, width - left);
      await page.evaluate(([x, y]) => {
        const element = document.getElementById('mat');
        element.style.left = `${-x}px`;
        element.style.top = `${-y}px`;
      }, [left, top]);
      const tile = png.decodePng(await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: columns, height: rows }, animations: 'disabled', caret: 'hide' }));
      if (tile.width !== columns || tile.height !== rows) {
        throw new Failure(1, `A tile came back ${tile.width} × ${tile.height} px, not the ${columns} × ${rows} asked for.`);
      }
      for (let row = 0; row < rows; row += 1) {
        let target = (row * width + left) * 3;
        let source = row * columns * tile.channels;
        for (let column = 0; column < columns; column += 1) {
          // Colour or grey, the alpha (a screenshot's is 255 over the white page) dropped
          strip[target] = tile.data[source];
          strip[target + 1] = tile.data[source + (tile.channels >= 3 ? 1 : 0)];
          strip[target + 2] = tile.data[source + (tile.channels >= 3 ? 2 : 0)];
          target += 3;
          source += tile.channels;
        }
      }
    }
    yield strip;
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.printCacheDir) {
    // The resolved config, as the server would get it: the plugins of the repo's config have had their say on it too
    process.stdout.write(`${(await resolveConfig(viteOptions, 'serve')).cacheDir}\n`);
    return;
  }

  // The text of every output, built before Chromium starts
  const server = await createServer(viteOptions);
  const jobs = [];
  let png;
  let pages;
  let matLib;
  try {
    let catalog;
    try {
      ({ scenarioCatalog: catalog } = await server.ssrLoadModule('/src/samples/robot-scenarios/index.ts'));
      matLib = await server.ssrLoadModule('/src/core/scenario/arena-mat.ts');
      png = await server.ssrLoadModule('/scripts/lib/png.ts');
      pages = await server.ssrLoadModule('/scripts/lib/pdf-page-box.ts');
    } catch (error) {
      // The catalog validates every scenario file as it loads
      throw new Failure(1, `The scenario sources did not load: ${messageOf(error)}`);
    }
    const keys = catalog.scenarios.map((scenario) => scenario.key);
    if (options.target !== 'all' && !keys.includes(options.target)) {
      throw new Failure(2, `No scenario "${options.target}". The keys are ${keys.join(', ')}, or "all". ${usage}`);
    }
    const fontCss = embeddedFontCss();
    for (const scenario of catalog.scenarios.filter((entry) => options.target === 'all' || entry.key === options.target)) {
      jobs.push({ key: scenario.key, mat: matLib.buildArenaMat(scenario), sheet: matLib.buildTiledSheet(scenario, { fontCss }), fontCss });
    }
  } finally {
    await server.close();
  }

  if (!existsSync(options.out)) mkdirSync(options.out, { recursive: true });
  else if (!statSync(options.out).isDirectory()) throw new Failure(2, `${options.out} is not a folder.`);

  const browser = await launchChromium();
  try {
    for (const job of jobs) {
      const started = Date.now();
      const file = (name) => join(options.out, name);
      // Relative to where the script was run when that is inside it, else in full
      const shown = (name) => {
        const path = relative(process.cwd(), file(name));
        return path.startsWith('..') || path === '' ? file(name) : path;
      };
      const { widthCm, heightCm } = job.mat;

      writeFileSync(file(`${job.key}.svg`), job.mat.svg);

      const page = await browser.newPage();
      try {
        const pdf = exactPages(`${job.key}.pdf`, await renderMatPdf(page, job.mat, job.fontCss), pages, 1, widthCm, heightCm);
        writeFileSync(file(`${job.key}.pdf`), pdf);

        const a4 = exactPages(`${job.key}-a4.pdf`, await renderTiledPdf(page, job.sheet, job.fontCss), pages, job.sheet.pages, 21, 29.7);
        writeFileSync(file(`${job.key}-a4.pdf`), a4);

        const size = matLib.matPixelSize(widthCm, heightCm);
        await png.writePng(
          file(`${job.key}.png`),
          { width: size.width, height: size.height, pixelsPerMetre: matLib.matPixelsPerMetre() },
          pngStrips(page, job.mat, size, job.fontCss, png),
        );
        process.stdout.write(
          `${job.key}: ${widthCm} × ${heightCm} cm -> ${shown(`${job.key}.svg`)}, ${shown(`${job.key}.pdf`)}, ${shown(`${job.key}-a4.pdf`)} ` +
            `(${job.sheet.pages} pages, ${job.sheet.cols} × ${job.sheet.rows}), ${shown(`${job.key}.png`)} (${size.width} × ${size.height} px at ${matLib.MAT_DPI} dpi), ` +
            `${((Date.now() - started) / 1000).toFixed(1)} s\n`,
        );
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

try {
  await main();
} catch (error) {
  process.stderr.write(`${messageOf(error)}\n`);
  process.exitCode = error instanceof Failure ? error.code : 1;
}
