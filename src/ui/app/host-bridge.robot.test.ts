import { describe, expect, it, vi } from 'vitest';
import { createNewProject } from '../../core/circuit/document';
import { createHostBridge, LAB_PROTOCOL, PROJECT_CHANGED_DEBOUNCE_MS, type HostBridge, type LabWindow } from './host-bridge';

// N18 R4.1 (plan §4.7): the robot lab's messages carry `lab: "robot"` and, in `ready`, the scenario's version and score; the
// Blockly and Yolo:Bit labs' messages are the ones they always were, byte for byte.

const hostOrigin = 'http://localhost:3000';

function setup(lab?: 'robot') {
  const posted: [unknown, string][] = [];
  const host = { postMessage: (message: unknown, targetOrigin: string) => void posted.push([message, targetOrigin]) };
  const window = { addEventListener: () => {}, removeEventListener: () => {} } as unknown as LabWindow;
  const bridge: HostBridge = createHostBridge({ host, hostOrigin, window, onLoadProject: () => {}, ...(lab === undefined ? {} : { lab }) });
  return { bridge, messages: () => posted.map(([message]) => message), origins: () => posted.map(([, origin]) => origin) };
}

describe('the robot lab’s messages (N18 R4.1)', () => {
  it('ready of a scored scenario: lab, template, profile, scenarioVersion 1, maxScore 100 and the goals', () => {
    const { bridge, messages, origins } = setup('robot');
    bridge.ready({ template: 'rb-stop-at-wall', profile: 'uno-basic', goals: [], robot: { scenarioVersion: 1, maxScore: 100 } });

    expect(messages()).toEqual([
      { protocol: LAB_PROTOCOL, type: 'ready', lab: 'robot', template: 'rb-stop-at-wall', profile: 'uno-basic', scenarioVersion: 1, maxScore: 100, goals: [] },
    ]);
    expect(origins()).toEqual([hostOrigin]);
  });

  it('ready of the sandbox has no maxScore: the field is left out, not null', () => {
    const { bridge, messages } = setup('robot');
    bridge.ready({ template: 'rb-sandbox', profile: 'uno-basic', goals: [], robot: { scenarioVersion: 1 } });

    const [ready] = messages() as Record<string, unknown>[];
    expect(ready).toEqual({ protocol: LAB_PROTOCOL, type: 'ready', lab: 'robot', template: 'rb-sandbox', profile: 'uno-basic', scenarioVersion: 1, goals: [] });
    expect(Object.hasOwn(ready ?? {}, 'maxScore')).toBe(false);
    expect(JSON.stringify(ready)).not.toContain('null');
  });

  it('ready without robot fields still says lab: robot, and sends nothing the host would read as null', () => {
    const { bridge, messages } = setup('robot');
    bridge.ready({ template: 'rb-sandbox', profile: null, goals: [{ id: 'g', label: 'Mục tiêu' }] });
    expect(messages()).toEqual([{ protocol: LAB_PROTOCOL, type: 'ready', lab: 'robot', template: 'rb-sandbox', profile: null, goals: [{ id: 'g', label: 'Mục tiêu' }] }]);
  });

  it('every other message of a robot lab carries lab: robot too', () => {
    vi.useFakeTimers();
    try {
      const { bridge, messages } = setup('robot');
      const document = createNewProject('robot');
      bridge.runStarted();
      bridge.runStopped();
      bridge.projectChanged(document);
      vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS);
      expect(messages()).toEqual([
        { protocol: LAB_PROTOCOL, type: 'run-started', lab: 'robot' },
        { protocol: LAB_PROTOCOL, type: 'run-stopped', lab: 'robot' },
        { protocol: LAB_PROTOCOL, type: 'project-changed', lab: 'robot', document },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a Blockly or Yolo:Bit lab has no lab field and no robot field, whatever it is given: byte-identical messages', () => {
    vi.useFakeTimers();
    try {
      const { bridge, messages } = setup();
      const document = createNewProject('p');
      bridge.ready({ template: 'ybc-heart', profile: 'ybc-basic', goals: [{ id: 'g', label: 'Trái tim' }], robot: { scenarioVersion: 1, maxScore: 100 } });
      bridge.runStarted();
      bridge.runStopped();
      bridge.checkResult({ passed: true, goals: [{ id: 'g', label: 'Trái tim', passed: true }] });
      bridge.projectChanged(document);
      vi.advanceTimersByTime(PROJECT_CHANGED_DEBOUNCE_MS);

      expect(messages().map((message) => JSON.stringify(message))).toEqual([
        '{"protocol":"stem-lab/v1","type":"ready","template":"ybc-heart","profile":"ybc-basic","goals":[{"id":"g","label":"Trái tim"}]}',
        '{"protocol":"stem-lab/v1","type":"run-started"}',
        '{"protocol":"stem-lab/v1","type":"run-stopped"}',
        '{"protocol":"stem-lab/v1","type":"check-result","passed":true,"goals":[{"id":"g","label":"Trái tim","passed":true}]}',
        `{"protocol":"stem-lab/v1","type":"project-changed","document":${JSON.stringify(document)}}`,
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('check-result keeps the goal shape, and carries lab: robot (the robot fields come with the checks, R6)', () => {
    const { bridge, messages } = setup('robot');
    bridge.checkResult({ passed: false, goals: [{ id: 'g', label: 'Mục tiêu', passed: false }] });
    expect(messages()).toEqual([{ protocol: LAB_PROTOCOL, type: 'check-result', lab: 'robot', passed: false, goals: [{ id: 'g', label: 'Mục tiêu', passed: false }] }]);
  });
});
