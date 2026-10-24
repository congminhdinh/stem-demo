import { z } from 'zod';
import { createDefaultProgram } from '../program/blocks';

// Project document contract (plan §6.1). Design state only: runtime state
// (pin levels, LED lit, pressed buttons) never lives here (B2).

const pointSchema = z.object({ x: z.number(), y: z.number() });

const portRefSchema = z.object({ componentId: z.string(), portId: z.string() });

const componentInstanceSchema = z.object({
  id: z.string(),
  /** = DeviceDefinition.id */
  deviceType: z.string(),
  /** Center of the device body, in world units. */
  position: pointSchema,
});

/** Electrically undirected; from/to is only the drawing order. */
const wireSchema = z.object({ id: z.string(), from: portRefSchema, to: portRefSchema });

export const projectDocumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string(),
  /**
   * The curriculum profile of a Yolo:Bit-compatible project (YB plan §8.3, R-F1) or, since N18 R2.1, of a robot
   * project (`uno-basic`, `uno-advanced`); the profile's family is the project's. Absent: a
   * generic project, exactly as before. Only its shape is checked here; whether the id is a
   * known profile is the loader's job (L-1), because the catalog of profiles is data. Not a
   * schema bump: old documents have no profile and mean what they always meant.
   */
  profile: z.string().min(1).optional(),
  /**
   * N18 R2.1 (robot plan §4.0): the kit of a robot project, `id@version`: which modules it has and on which ports. Absent:
   * the reference kit `ref-uno-rover@0`. Declared here because Zod drops keys a schema does not name. Only its shape is
   * checked; whether the kit is known is the kit catalog's job (R1). Not a schema bump, like `profile`.
   */
  kit: z.object({ id: z.string(), version: z.string() }).optional(),
  circuit: z.object({
    components: z.array(componentInstanceSchema),
    wires: z.array(wireSchema),
  }),
  /** Blockly serialization JSON; only the compiler and the Blockly panel read it. */
  program: z.object({ blocks: z.unknown() }),
});

export type ProjectDocument = z.infer<typeof projectDocumentSchema>;
export type Circuit = ProjectDocument['circuit'];
export type ComponentInstance = z.infer<typeof componentInstanceSchema>;
export type Wire = z.infer<typeof wireSchema>;
export type PortRef = z.infer<typeof portRefSchema>;
export type Point = z.infer<typeof pointSchema>;

export function isSamePort(a: PortRef, b: PortRef): boolean {
  return a.componentId === b.componentId && a.portId === b.portId;
}

/** What "New" opens (plan POC-11): no components, no wires, the default program. */
export function createNewProject(id: string): ProjectDocument {
  return {
    schemaVersion: 1,
    id,
    name: 'Untitled',
    circuit: { components: [], wires: [] },
    program: { blocks: createDefaultProgram() },
  };
}
