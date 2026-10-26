import type { LowTierStep } from './frame-watch';

// N18 P2 fix round 1 (C1): the low tier's chain (frame-watch.ts createLowTierWatch, SceneHost.tsx) as the dev hooks drive it. The E2E
// pins it off (`window.__stem.robot.setLowTierChain('off')`): a busy machine, the suite's own SwiftShader workers, would otherwise cap
// a spec's run at 30 fps; the chain's own spec forces its steps (`forceLowTierStep`). A production build makes one and never calls it,
// so the chain runs by itself there ('auto').

export type LowTierChainMode = 'auto' | 'off';

export type LowTierControl = {
  /** 'auto': the frame watch takes the steps; 'off': it takes none (forced steps still apply). */
  mode(): LowTierChainMode;
  setMode(mode: LowTierChainMode): void;
  /** Takes `step` now, as the watch would. */
  force(step: LowTierStep): void;
  /** Hears each new mode and each forced step; returns the way to stop. */
  subscribe(listener: (event: { kind: 'mode'; mode: LowTierChainMode } | { kind: 'step'; step: LowTierStep }) => void): () => void;
};

export function createLowTierControl(): LowTierControl {
  let current: LowTierChainMode = 'auto';
  const listeners = new Set<Parameters<LowTierControl['subscribe']>[0]>();
  return {
    mode: () => current,
    setMode(mode) {
      if (mode !== 'auto' && mode !== 'off') throw new RangeError(`The low tier's chain is 'auto' or 'off', not ${String(mode)}.`);
      current = mode;
      for (const listener of [...listeners]) listener({ kind: 'mode', mode });
    },
    force(step) {
      if (step !== 'cap' && step !== 'offer') throw new RangeError(`A step of the low tier's chain is 'cap' or 'offer', not ${String(step)}.`);
      for (const listener of [...listeners]) listener({ kind: 'step', step });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
