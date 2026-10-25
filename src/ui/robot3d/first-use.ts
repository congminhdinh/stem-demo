import { LAB_PROTOCOL } from '../app/host-bridge';

// N18 P2: the first sign that the robot lab is going to be used: a pointer press or a key anywhere in its page, or a project the host
// loads (stem-lab/v1 `load-project`). The lab then loads and warms the physics engine at idle (RobotLab.tsx), so that neither the first
// Run nor the first Kiểm tra waits for it; a lab that is only opened downloads none of it (the engine's wasm is 1.2 MB with gzip).

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;

/** Calls `onUse` once, at the first press, key or host's load-project on `target` (the lab's window); returns the way to stop watching. */
export function onFirstUse(target: Target, onUse: () => void): () => void {
  const options = { capture: true } as const;
  const stop = () => {
    target.removeEventListener('pointerdown', use, options);
    target.removeEventListener('keydown', use, options);
    target.removeEventListener('message', onMessage, options);
  };
  function use() {
    stop();
    onUse();
  }
  function onMessage(event: Event) {
    const data = (event as MessageEvent).data as { protocol?: unknown; type?: unknown } | null;
    if (data !== null && typeof data === 'object' && data.protocol === LAB_PROTOCOL && data.type === 'load-project') use();
  }
  target.addEventListener('pointerdown', use, options);
  target.addEventListener('keydown', use, options);
  target.addEventListener('message', onMessage, options);
  return stop;
}
