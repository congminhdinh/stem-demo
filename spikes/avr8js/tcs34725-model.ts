// The TCS34725 register model of the G0.2 spike now lives in src (task N19 A3 moved it, behaviour unchanged): the spike's runners read
// the production model, so the board side and the simulator side keep calling one model.
export * from '../../src/core/hardware/devices/tcs34725.ts';
