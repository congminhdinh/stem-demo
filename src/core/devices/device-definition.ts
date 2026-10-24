import { z } from 'zod';
import { ANALOG_NATIVE_MAX, PWM_DUTY_MAX } from '../simulation/conversions';

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

const pinCapabilitySchema = z.enum(['digital', 'analogIn', 'pwm', 'servo', 'pulse']);

/** What an onboard part is, where our artwork draws it and what its simulation model is called (YB plan §8.1). */
const onboardPeripheralSchema = z.object({
  id: z.string(),
  /** Simulation model id; the models themselves arrive with their capability phases. */
  model: z.string(),
  capability: z.string(),
  /** Static, contract-derived settings, e.g. the display geometry. */
  config: z.record(z.string(), z.unknown()).optional(),
  /** Top-left corner and size, relative to the body center, in world units. */
  at: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  label: z.string(),
});

export const deviceDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Body size; the body is centered on the component position. */
  body: z.object({ width: z.number(), height: z.number() }),
  ports: z.array(portDefinitionSchema).min(1),
  renderer: z.string(),
  simulation: z.object({ model: z.string() }),
  /**
   * Which board family may place this device (YB plan §8.1, R-F3; N18 R2.1 adds `uno`, the UNO-compatible
   * board of the robot lab). Absent means `generic`, so the generic definitions stay valid without a new line.
   */
  family: z.enum(['generic', 'ybc', 'uno']).optional(),
  /** Boards only: the pin names a program can use (the board profile). */
  board: z
    .object({
      pins: z.array(
        z.object({
          name: z.string(),
          portId: z.string(),
          /** Absent means digital only. Each capability must be evidenced per pin by the contract. */
          capabilities: z.array(pinCapabilitySchema).optional(),
        }),
      ),
      /** ybc and uno boards: the code the board's programs are generated for (MicroPython for Yolo:Bit, C++ for Arduino AVR, N18). */
      codeTarget: z.enum(['yolobit-micropython', 'arduino-avr']).optional(),
      /** ybc boards only: static description of the onboard parts. No behaviour lives here. */
      onboard: z.array(onboardPeripheralSchema).optional(),
      /** Pins used by onboard hardware: never wireable, never in dropdowns. */
      reservedPins: z.array(z.string()).optional(),
      /**
       * N18 R2.1: the native scales of the board, an analog read 0..adcMax and a PWM duty 0..pwmMax (UNO: 1023 and 255).
       * Absent: the Yolo:Bit contract's (C-25, C-26), so ybc-board.json stays as it is. Read through `boardScaleOf`.
       */
      scale: z.object({ adcMax: z.number().int().positive(), pwmMax: z.number().int().positive() }).optional(),
    })
    .optional(),
});

export type DeviceDefinition = z.infer<typeof deviceDefinitionSchema>;
export type PortDefinition = DeviceDefinition['ports'][number];
export type DeviceFamily = NonNullable<DeviceDefinition['family']>;
export type OnboardPeripheral = NonNullable<NonNullable<DeviceDefinition['board']>['onboard']>[number];
export type BoardScale = NonNullable<NonNullable<DeviceDefinition['board']>['scale']>;

/** The family of a device: `generic` unless the definition says otherwise. */
export function deviceFamily(definition: DeviceDefinition): DeviceFamily {
  return definition.family ?? 'generic';
}

/**
 * N18 R2.1: the native scales of a board (simulation/conversions.ts converts with them): its own data, or the Yolo:Bit
 * contract's 0..4095 analog read and 0..1023 duty when it gives none.
 */
export function boardScaleOf(definition: DeviceDefinition): BoardScale {
  return definition.board?.scale ?? { adcMax: ANALOG_NATIVE_MAX, pwmMax: PWM_DUTY_MAX };
}

export function findPort(definition: DeviceDefinition, portId: string): PortDefinition | undefined {
  return definition.ports.find((port) => port.id === portId);
}
