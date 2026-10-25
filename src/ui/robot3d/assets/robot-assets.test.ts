import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetFailedRobotAssets, LOAD_TIMEOUT_MS, loadRobotAssets } from './robot-assets';

// N18 R4.7 fix round 1: the tier's model files load once per page, but a load that failed (a 404, a parse error) or stalled (no answer
// within 15 s, then the view draws its simple shapes) is tried again when the learner asks for a new 3D view.

afterEach(() => {
  forgetFailedRobotAssets();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('loading the robot lab’s 3D models (N18 R4.7)', () => {
  it('gives up on a request that does not answer within the time limit, and the view draws its simple shapes', async () => {
    expect(LOAD_TIMEOUT_MS).toBe(15_000);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const signalOf = (input: RequestInfo, init?: RequestInit) => init?.signal ?? (input instanceof Request ? input.signal : undefined);
    const fetch = vi.fn((input: RequestInfo, init?: RequestInit) => new Promise<Response>((_, reject) => signalOf(input, init)?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))));
    vi.stubGlobal('fetch', fetch);
    const attempt = loadRobotAssets('low', 'http://lab.test/', 40);
    expect(await attempt).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
    // Every request it made was called off.
    for (const [input, init] of fetch.mock.calls) expect(signalOf(input, init)?.aborted).toBe(true);
  });

  it('keeps a load that failed for the view that asked (the same promise), and tries again once it is forgotten', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const fetch = vi.fn(async () => new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const first = loadRobotAssets('high', 'http://lab.test/');
    expect(await first).toBeNull();
    expect(loadRobotAssets('high', 'http://lab.test/')).toBe(first);
    expect(fetch).toHaveBeenCalledTimes(2);
    forgetFailedRobotAssets();
    const second = loadRobotAssets('high', 'http://lab.test/');
    expect(second).not.toBe(first);
    expect(await second).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('does not forget a load that is still under way', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)));
    const pending = loadRobotAssets('low', 'http://lab.test/', 60_000);
    forgetFailedRobotAssets();
    expect(loadRobotAssets('low', 'http://lab.test/')).toBe(pending);
  });
});
