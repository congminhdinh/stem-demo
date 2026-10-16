import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../../core/circuit/document';
import { createHostBridge, LAB_PROTOCOL, PROJECT_CHANGED_DEBOUNCE_MS, type LabWindow } from './host-bridge';

// The lab's side of stem-lab/v1 (N6a S3) against fake windows: what it posts, to whom, and what it takes.

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const hostOrigin = 'http://localhost:3000';

function setup() {
  const posted: [unknown, string][] = [];
  const host = { postMessage: (message: unknown, targetOrigin: string) => void posted.push([message, targetOrigin]) };
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const window = {
    addEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.set(type, (listeners.get(type) ?? new Set()).add(listener));
    },
    removeEventListener: (type: string, listener: (event: unknown) => void) => {
      listeners.get(type)?.delete(listener);
    },
  } as unknown as LabWindow;
  const fire = (type: string, event: unknown = {}) => [...(listeners.get(type) ?? [])].forEach((listener) => listener(event));
  const loaded: unknown[] = [];
  const bridge = createHostBridge({ host, hostOrigin, window, onLoadProject: (document) => void loaded.push(document) });
  return { bridge, host, posted, fire, loaded, listeners };
}

describe('createHostBridge (N6a S3)', () => {
  it('posts every message with the protocol, to the host origin only', () => {
    const { bridge, posted } = setup();
    bridge.ready({ template: 'ybc-heart', profile: 'ybc-basic', goals: [{ id: 'g', label: 'Trái tim' }] });
    bridge.runStarted();
    bridge.runStopped();
    bridge.checkResult({ passed: true, goals: [{ id: 'g', label: 'Trái tim', passed: true }] });

    expect(posted).toEqual([
      [{ protocol: LAB_PROTOCOL, type: 'ready', template: 'ybc-heart', profile: 'ybc-basic', goals: [{ id: 'g', label: 'Trái tim' }] }, hostOrigin],
      [{ protocol: LAB_PROTOCOL, type: 'run-started' }, hostOrigin],
      [{ protocol: LAB_PROTOCOL, type: 'run-stopped' }, hostOrigin],
      [{ protocol: LAB_PROTOCOL, type: 'check-result', passed: true, goals: [{ id: 'g', label: 'Trái tim', passed: true }] }, hostOrigin],
    ]);
    expect(posted.map(([, origin]) => origin)).not.toContain('*');
  });

  it('sends only id and label of a goal, within what the host accepts (50 goals, 200 characters)', () => {
    const { bridge, posted } = setup();
    const goals = Array.from({ length: 60 }, (_, index) => ({ id: `g${index}`, label: 'x'.repeat(250), kind: 'led-lit' as const, componentId: 'led' }));
    bridge.ready({ template: 'blink', profile: null, goals });

    const [message] = posted[0] as [{ goals: { id: string; label: string }[] }, string];
    expect(message.goals).toHaveLength(50);
    expect(message.goals[0]).toEqual({ id: 'g0', label: 'x'.repeat(200) });
  });

  it('sends the project one second after the last change, once', async () => {
    const { bridge, posted } = setup();
    const first = createNewProject('a');
    const last = createNewProject('b');
    bridge.projectChanged(first);
    await vi.advanceTimersByTimeAsync(PROJECT_CHANGED_DEBOUNCE_MS - 1);
    bridge.projectChanged(last);
    await vi.advanceTimersByTimeAsync(PROJECT_CHANGED_DEBOUNCE_MS - 1);
    expect(posted).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);

    expect(posted).toEqual([[{ protocol: LAB_PROTOCOL, type: 'project-changed', document: last }, hostOrigin]]);
  });

  it('sends a pending project at once when the page goes away, and only once', async () => {
    const { bridge, posted, fire } = setup();
    bridge.projectChanged(createNewProject('a'));
    fire('pagehide');
    await vi.advanceTimersByTimeAsync(PROJECT_CHANGED_DEBOUNCE_MS);

    expect(posted).toHaveLength(1);
    bridge.flush();
    expect(posted).toHaveLength(1);
  });

  it('takes a load-project from the parent window at the host origin', () => {
    const { host, fire, loaded } = setup();
    const document = { any: 'thing' };
    fire('message', { origin: hostOrigin, source: host, data: { protocol: LAB_PROTOCOL, type: 'load-project', document } });

    expect(loaded).toEqual([document]);
  });

  it.each([
    ['another origin', (host: unknown) => ({ origin: 'http://evil.example', source: host, data: { protocol: LAB_PROTOCOL, type: 'load-project', document: {} } })],
    ['the host origin from another window', () => ({ origin: hostOrigin, source: {}, data: { protocol: LAB_PROTOCOL, type: 'load-project', document: {} } })],
    ['another protocol', (host: unknown) => ({ origin: hostOrigin, source: host, data: { protocol: 'stem-lab/v2', type: 'load-project', document: {} } })],
    ['another type', (host: unknown) => ({ origin: hostOrigin, source: host, data: { protocol: LAB_PROTOCOL, type: 'ready', document: {} } })],
    ['no document', (host: unknown) => ({ origin: hostOrigin, source: host, data: { protocol: LAB_PROTOCOL, type: 'load-project' } })],
    ['no data', (host: unknown) => ({ origin: hostOrigin, source: host, data: null })],
    ['a string', (host: unknown) => ({ origin: hostOrigin, source: host, data: 'load-project' })],
  ])('ignores a message from %s', (_, event) => {
    const { host, fire, loaded } = setup();
    fire('message', event(host));

    expect(loaded).toEqual([]);
  });

  it('after dispose: listens to nothing, posts nothing, drops a pending project', async () => {
    const { bridge, host, posted, fire, loaded, listeners } = setup();
    bridge.projectChanged(createNewProject('a'));
    bridge.dispose();
    fire('message', { origin: hostOrigin, source: host, data: { protocol: LAB_PROTOCOL, type: 'load-project', document: {} } });
    bridge.runStarted();
    await vi.advanceTimersByTimeAsync(PROJECT_CHANGED_DEBOUNCE_MS);

    expect(posted).toEqual([]);
    expect(loaded).toEqual([]);
    expect([...listeners.values()].every((set) => set.size === 0)).toBe(true);
  });
});
