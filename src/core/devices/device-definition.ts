import { z } from 'zod';

// Device metadata is data (plan §5.1 B6, §6.2). Renderers and simulation
// models are referenced by string id and live in code elsewhere.

const portDefinitionSchema = z.object({
  id: z.string(),
  label: z.string(),
  /** Offset from the body center, in world units. */
  x: z.number(),
  y: z.number(),
  kind: z.enum(['gpio', 'power', 'ground', 'passive']),
});

export const deviceDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Body size; the body is centered on the component position. */
  body: z.object({ width: z.number(), height: z.number() }),
  ports: z.array(portDefinitionSchema).min(1),
  renderer: z.string(),
  simulation: z.object({ model: z.string() }),
  /** Boards only: the pin names a program can use (the board profile). */
  board: z
    .object({ pins: z.array(z.object({ name: z.string(), portId: z.string() })) })
    .optional(),
});

export type DeviceDefinition = z.infer<typeof deviceDefinitionSchema>;
export type PortDefinition = DeviceDefinition['ports'][number];

export function findPort(definition: DeviceDefinition, portId: string): PortDefinition | undefined {
  return definition.ports.find((port) => port.id === portId);
}
