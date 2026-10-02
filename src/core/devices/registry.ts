import { deviceDefinitionSchema, type DeviceDefinition } from './device-definition';

export type DeviceRegistry = {
  /** Throws for an unknown device type: a document referencing one is invalid. */
  get(deviceType: string): DeviceDefinition;
  /** Every definition, in catalog order (the palette lists these). */
  list(): DeviceDefinition[];
};

/**
 * Builds the registry from raw definition data. Invalid definitions are a
 * programmer error, so this fails fast with Zod's message.
 */
export function createDeviceRegistry(rawDefinitions: readonly unknown[]): DeviceRegistry {
  const byId = new Map<string, DeviceDefinition>();
  for (const raw of rawDefinitions) {
    const definition = deviceDefinitionSchema.parse(raw);
    byId.set(definition.id, definition);
  }

  return {
    get(deviceType) {
      const definition = byId.get(deviceType);
      if (!definition) {
        throw new Error(`Unknown device type "${deviceType}"`);
      }
      return definition;
    },
    list: () => [...byId.values()],
  };
}
