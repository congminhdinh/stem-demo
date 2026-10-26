import type { BoardProfile } from './board';
import { loadBoard } from './board-schema';
import { kitKey, type Kit, type KitRef } from './kit';
import { loadKit } from './kit-schema';
import refUnoGripperJson from './kits/ref-uno-gripper.kit.json';
import refUnoRoverJson from './kits/ref-uno-rover.kit.json';
import unoR3Json from './uno-r3.board.json';

// The boards and kits this build knows (N18 R1.1). A project names its kit `id@version` (document.ts `kit`, plan §4.0); the
// catalog says whether it is known. Invalid data is a programmer error, so building a catalog fails fast.

export type KitCatalog = {
  /** The kit, or undefined when the catalog does not know it. */
  get(ref: KitRef): Kit | undefined;
  /** The board profile of a known kit. */
  boardOf(ref: KitRef): BoardProfile | undefined;
  /** Every kit, in catalog order. */
  refs(): KitRef[];
};

export function createKitCatalog(rawKits: readonly unknown[], boards: readonly BoardProfile[]): KitCatalog {
  const byId = new Map(boards.map((board) => [board.id, board]));
  const kits = new Map<string, { kit: Kit; board: BoardProfile }>();
  for (const raw of rawKits) {
    const boardId = (raw as { board?: unknown } | null)?.board;
    const board = typeof boardId === 'string' ? byId.get(boardId) : undefined;
    if (!board) {
      throw new Error(`A kit names no board this build has (no board ${String(boardId)})`);
    }
    const kit = loadKit(raw, board);
    if (kits.has(kitKey(kit))) {
      throw new Error(`Kit ${kitKey(kit)} is listed twice`);
    }
    kits.set(kitKey(kit), { kit, board });
  }
  return {
    get: (ref) => kits.get(kitKey(ref))?.kit,
    boardOf: (ref) => kits.get(kitKey(ref))?.board,
    refs: () => [...kits.values()].map(({ kit }) => ({ id: kit.id, version: kit.version })),
  };
}

export const unoR3Board: BoardProfile = loadBoard(unoR3Json);

/** The kit of a robot project that names none (plan §4.0): its pins are PLACEHOLDERs until the vendor answers (kits/README.md). */
export const referenceKitRef: KitRef = { id: 'ref-uno-rover', version: '0' };

/** The kits of the robot labs, in robot-keys.ts `robotKits` order: the rover, and (N19 A2) the gripper car. */
export const productionKits: KitCatalog = createKitCatalog([refUnoRoverJson, refUnoGripperJson], [unoR3Board]);

/** N18 R2.2: what a learner is told of a kit the catalog does not know (L-1 `unknown-kit`; the compile of such a project says the same). */
export const unknownKitMessage = (ref: KitRef): string => `The robot kit "${kitKey(ref)}" is not one this app knows.`;

/** The kit a project uses: its own, or the reference kit. */
export function kitRefOf(document: { readonly kit?: KitRef }): KitRef {
  return document.kit ? { id: document.kit.id, version: document.kit.version } : { ...referenceKitRef };
}
