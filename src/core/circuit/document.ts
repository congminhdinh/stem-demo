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
