import type { ProjectDocument } from '../../core/circuit/document';
import type { UnoLineRange } from '../../core/codegen/arduino/generate';
import { generateCodeForDocument } from '../../core/codegen/generate-code';
import type { DocumentDiagnostic } from '../../core/codegen/yolobit/generate-document';
import type { UnoProjectRules } from '../../core/program/compile-uno-program';
import type { ValidityLayer } from '../../core/profiles/validity';
import { sketchLines } from './cpp-lines';

// The code the C++ tab shows (N18 R4.5): the Arduino sketch of the robot project (C1's `generateCodeForDocument`, which compiles the
// project against its kit and writes the sketch with the scenario in its header), or the diagnostics of why there is none, as the
// Python panel does for a Yolo:Bit project. Never a half sketch and never a stale one: what the project cannot make, the tab says.

export type SketchView =
  | { ok: true; source: string; lines: string[]; lineMap: UnoLineRange[] }
  | { ok: false; layer: ValidityLayer; diagnostics: DocumentDiagnostic[] };

/** The scenario the sketch is written for: its key and version go in the header, its file name is `<key>.ino`. */
export type SketchScenario = { key: string; version: number };

/** The name of the file a sketch is saved as. */
export const sketchFileName = (scenario: Pick<SketchScenario, 'key'>) => `${scenario.key}.ino`;

const noCode = (message: string): SketchView => ({ ok: false, layer: 'L-1', diagnostics: [{ severity: 'error', code: 'no-code-target', message }] });

export function sketchOf(project: ProjectDocument, rules: UnoProjectRules, scenario: SketchScenario): SketchView {
  try {
    const code = generateCodeForDocument(project, { ...rules, scenario: { key: scenario.key, version: scenario.version } });
    if (code === null || code.codeTarget !== 'arduino-avr') {
      return noCode('This project has no Arduino code.');
    }
    const { generation } = code;
    return generation.ok ? { ok: true, source: generation.source, lines: sketchLines(generation.source), lineMap: generation.lineMap } : generation;
  } catch (error) {
    // A project of another family (a host's load-project the lab did not refuse): the tab says so rather than take the lab down.
    return noCode(error instanceof Error ? error.message : 'This project has no Arduino code.');
  }
}
