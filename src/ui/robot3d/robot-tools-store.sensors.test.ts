import { describe, expect, it } from 'vitest';
import { productionKits } from '../../core/hardware/catalog';
import type { Kit } from '../../core/hardware/kit';
import { scenarioCatalog } from '../../samples/robot-scenarios';
import { fakeSession } from './__fixtures__/fake-session';
import { createRobotRunStore } from './robot-run-store';
import { createRobotToolsStore } from './robot-tools-store';

// N18 R4.3: the sensor overlays' switch lives in the view tools' store: on at first, and nothing a tool, a lock or a run does turns it off.

const kit = productionKits.get({ id: 'ref-uno-rover', version: '0' }) as Kit;
const scenario = scenarioCatalog.get('rb-stop-at-wall')!;

function setup() {
  const fake = fakeSession(scenario, kit);
  const store = createRobotRunStore(fake.session);
  store.getState().connect();
  return { store, tools: createRobotToolsStore({ runStore: store, scenario, kit }) };
}

describe('the sensor overlays’ switch in the tools store', () => {
  it('is on at first, and is the learner’s to turn off and on', () => {
    const { tools } = setup();
    expect(tools.getState().sensors).toBe(true);
    tools.getState().setSensors(false);
    expect(tools.getState().sensors).toBe(false);
    tools.getState().setSensors(true);
    expect(tools.getState().sensors).toBe(true);
  });

  it('tells its subscribers only when it changes', () => {
    const { tools } = setup();
    const seen: boolean[] = [];
    tools.subscribe((state, previous) => {
      if (state.sensors !== previous.sensors) seen.push(state.sensors);
    });
    tools.getState().setSensors(true);
    tools.getState().setSensors(false);
    tools.getState().setSensors(false);
    tools.getState().setSensors(true);
    expect(seen).toEqual([false, true]);
  });

  it('stays through a check’s lock, a tool and a run (the overlays are on in a check, 1× and 4×, and in a replay)', () => {
    const { store, tools } = setup();
    store.getState().setLocked(true);
    expect(tools.getState().sensors).toBe(true);
    store.getState().setLocked(false);
    tools.getState().setTool('ruler');
    tools.getState().setTool(null);
    tools.getState().setSensors(false);
    store.getState().setLocked(true);
    store.getState().setLocked(false);
    expect(tools.getState().sensors).toBe(false);
  });
});
