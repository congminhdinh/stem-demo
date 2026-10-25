import type { CameraMode } from './camera';

// What the keyboard tells the 3D view's camera (N18 R8): the lab reads the keys (use-camera-keys.ts) and emits a command here; the view
// that owns the camera's mode (SceneHost) takes the mode and reset, and the rig that moves the camera (CameraRig) the zoom and the orbit.

export type CameraCommand =
  | { kind: 'mode'; mode: CameraMode }
  | { kind: 'reset' }
  | { kind: 'zoom'; direction: 'in' | 'out' }
  /** One step of an orbit: the camera swings right (dx = 1) or left (−1), rises (dy = 1) or sinks (−1). In the top view it pans instead. */
  | { kind: 'orbit'; dx: -1 | 0 | 1; dy: -1 | 0 | 1 };

export type CameraCommands = {
  emit(command: CameraCommand): void;
  /** Listens to the commands; returns the way to stop. */
  subscribe(listener: (command: CameraCommand) => void): () => void;
};

export function createCameraCommands(): CameraCommands {
  const listeners = new Set<(command: CameraCommand) => void>();
  return {
    emit: (command) => {
      for (const listener of [...listeners]) listener(command);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
