// The hardware abstraction layer of the robot lab (N18 R1, robot plan §4.1–§4.3): Block → API → pin/port → module.
// A program's module op (`motor.set(motorLeft, 50)`) reaches the kit (role → port → driver → pins), the driver writes pins of
// the virtual UNO, and the world reads those pins. Everything a board or kit says is data; drivers are reviewed code by id.

export * from './board';
export * from './board-schema';
export * from './board-target';
export * from './catalog';
export * from './kit';
export * from './kit-schema';
export * from './pin-rules';
