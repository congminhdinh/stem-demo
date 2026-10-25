import { describe, expect, it } from 'vitest';
import { arduinoCalls as contractArduinoCalls } from '../compat/contract-types';
import { unoContract } from '../compat/uno-contract';
import { hardwareDiagnosticCodes } from '../capabilities/diagnostics';
import { arduinoCalls } from './board';
import { unoR3Board as board } from './catalog';

// N18 R1: production code never imports the UNO contract's data (uno-contract.test.ts "is read by tests only"); it copies the
// values it uses. These tests pin every copied value to the contract, so a contract edit cannot drift from the hardware layer.

describe('the uno-r3 board profile is the contract’s board (contract §4.4, §5)', () => {
  it('charges the contract’s measured costs, for exactly the contract’s Arduino calls', () => {
    expect([...arduinoCalls]).toEqual([...contractArduinoCalls]);
    expect(board.costsUs).toEqual(unoContract.costsUs);
  });

  it('charges tone() by the contract’s frequency bands, on a silent pin and on a playing one (contract 0.1.6 §4.4, EMU-18)', () => {
    expect(board.toneUs).toEqual(unoContract.toneUs.bands);
    expect(unoContract.toneUs.evidence).toEqual(['EMU-18']);
    // Tone.cpp takes prescaler p once floor(8e6 / (p · f)) ≤ 256.
    expect(board.toneUs.map((band) => band.fromHz)).toEqual(board.toneUs.map((band) => Math.floor(16e6 / (514 * band.prescaler)) + 1));
  });

  it('has the contract’s PWM pins and timers, reserved pins, timer claims and non-PWM threshold', () => {
    expect(board.pins.filter((pin) => pin.pwmTimer).map((pin) => ({ pin: pin.id, timer: pin.pwmTimer }))).toEqual(
      unoContract.board.pwmPins.map(({ pin, timer }) => ({ pin, timer })),
    );
    expect(board.reserved).toEqual(unoContract.board.reserved);
    expect(board.timerClaims).toEqual(unoContract.board.timerClaims);
    expect(board.nonPwmThreshold).toBe(unoContract.board.nonPwmThreshold);
  });

  it('is the contract’s MCU, clock, scales, millis model and emulator', () => {
    expect({ mcu: board.mcu, clockHz: board.clockHz, adcMax: board.adcMax, pwmMax: board.pwmMax }).toEqual({
      mcu: unoContract.board.mcu,
      clockHz: unoContract.board.clockHz,
      adcMax: unoContract.board.adcMax,
      pwmMax: unoContract.board.pwmMax,
    });
    const { overflowUs, fractPerOverflow, fractMax } = unoContract.millis;
    expect(board.millis).toEqual({ overflowUs, fractPerOverflow, fractMax });
    expect(board.emulator).toBe(unoContract.snapshot.emulator.name);
  });
});

describe('the hardware diagnostics are the contract’s where it names them (contract §13)', () => {
  it('takes timer-claimed, pin-unavailable, not-pwm and value-clamped from the contract, with its severities; the rest are R1’s', () => {
    const contractCodes = new Map(unoContract.diagnostics.map((diagnostic) => [diagnostic.id, diagnostic.severity]));
    const shared = hardwareDiagnosticCodes.filter((code) => contractCodes.has(code));
    expect(shared).toEqual(['timer-claimed', 'pin-unavailable', 'not-pwm', 'value-clamped']);
    expect(shared.map((code) => contractCodes.get(code))).toEqual(['error', 'error', 'warning', 'warning']);
    // Named by the robot plan's R1 tests: two ports on one pin, D0 used while serial, a wire write nobody acks.
    expect(hardwareDiagnosticCodes.filter((code) => !contractCodes.has(code))).toEqual(['pin-conflict', 'pin-reserved', 'wire-nack']);
  });
});
