import { afterEach, describe, expect, it, vi } from 'vitest';
import { robotTemplateKeys } from '../../samples/robot-templates';
import { localizeLaunchProblem } from '../i18n/core-text';
import { parseLaunch } from './launch';

// The launch asks robot-templates.ts which level a scenario needs. It is the same function, with the `needed` parameter a test may set,
// so that a test can say a scenario needs more than uno-basic (none does yet) without changing the table of scenarios.
const scenario = vi.hoisted(() => ({ needs: undefined as 'uno-basic' | 'uno-advanced' | undefined }));
vi.mock('../../samples/robot-templates', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../samples/robot-templates')>();
  const robotTemplateProfileProblem = (...[key, profile]: Parameters<typeof original.robotTemplateProfileProblem>) =>
    original.robotTemplateProfileProblem(key, profile, scenario.needs);
  return { ...original, robotTemplateProfileProblem };
});

// N18 R4.1: `?embed=1&lab=robot&template=rb-<key>&profile=uno-basic|uno-advanced&origin=<o>` (plan §4.7).

const host = 'http://localhost:3000';
const robot = (profile: string | null = null, hostOrigin: string | null = host) => ({ kind: 'robot', profile, hostOrigin });

describe('parseLaunch: lab=robot (N18 R4.1)', () => {
  it.each(robotTemplateKeys)('opens the robot lab of %s, with or without a profile', (key) => {
    expect(parseLaunch(`?embed=1&lab=robot&template=${key}&origin=${host}`)).toEqual({ mode: 'embed', template: key, lab: robot() });
    expect(parseLaunch(`?embed=1&lab=robot&template=${key}&profile=uno-basic&origin=${host}`)).toEqual({ mode: 'embed', template: key, lab: robot('uno-basic') });
    expect(parseLaunch(`?embed=1&lab=robot&template=${key}&profile=uno-advanced&origin=${host}`)).toEqual({ mode: 'embed', template: key, lab: robot('uno-advanced') });
  });

  it('reads the URL the learn app builds, percent-encoded origin included', () => {
    expect(parseLaunch('?embed=1&lab=robot&template=rb-stop-at-wall&origin=http%3A%2F%2Flocalhost%3A3000&profile=uno-basic')).toEqual({
      mode: 'embed',
      template: 'rb-stop-at-wall',
      lab: robot('uno-basic'),
    });
  });

  it('opens without origin like the other labs: it works but has no host to talk to', () => {
    expect(parseLaunch('?embed=1&lab=robot&template=rb-sandbox')).toEqual({ mode: 'embed', template: 'rb-sandbox', lab: robot(null, null) });
  });

  it.each([
    // An unknown rb-* key, a key of another lab, a missing or repeated one: an error screen listing the robot scenarios, never a project.
    ['?embed=1&lab=robot&template=rb-unknown', 'Unknown template "rb-unknown".'],
    ['?embed=1&lab=robot&template=RB-SANDBOX', 'Unknown template "RB-SANDBOX".'],
    ['?embed=1&lab=robot&template=rb-', 'Unknown template "rb-".'],
    ['?embed=1&lab=robot&template=blink', 'The template "blink" does not open in lab=robot.'],
    ['?embed=1&lab=robot&template=ybc-heart', 'The template "ybc-heart" does not open in lab=robot.'],
    ['?embed=1&lab=robot', 'No template was given: add template=<key>.'],
    ['?embed=1&lab=robot&template=', 'No template was given: add template=<key>.'],
    ['?embed=1&lab=robot&template=rb-sandbox&template=rb-sandbox', 'template must be given once.'],
    // The profile: the robot's own two, once.
    ['?embed=1&lab=robot&template=rb-sandbox&profile=ybc-basic', 'Unknown profile "ybc-basic": use uno-basic or uno-advanced.'],
    ['?embed=1&lab=robot&template=rb-sandbox&profile=', 'Unknown profile "": use uno-basic or uno-advanced.'],
    ['?embed=1&lab=robot&template=rb-sandbox&profile=UNO-BASIC', 'Unknown profile "UNO-BASIC": use uno-basic or uno-advanced.'],
    ['?embed=1&lab=robot&template=rb-sandbox&profile=uno-basic&profile=uno-basic', 'profile must be given once.'],
    [`?embed=1&lab=robot&template=rb-sandbox&origin=${host}&origin=${host}`, 'origin must be given once.'],
    ['?embed=1&lab=robot&template=rb-sandbox&origin=*', 'origin "*" is not a page origin such as https://school.example.'],
    ['?embed=1&lab=robot&lab=robot&template=rb-sandbox', 'lab must be given once.'],
  ])('refuses the robot launch %j', (search, problem) => {
    const launch = parseLaunch(search);
    expect(launch).toMatchObject({ mode: 'invalid', problem });
    expect(Object.hasOwn(launch, 'template')).toBe(false);
  });

  it('names the robot lab in the error, so the screen lists the robot scenarios', () => {
    expect(parseLaunch('?embed=1&lab=robot&template=rb-unknown')).toEqual({ mode: 'invalid', problem: 'Unknown template "rb-unknown".', lab: 'robot' });
  });

  it.each(robotTemplateKeys)('refuses %s in another lab, and without a lab (the legacy launch has no robot)', (key) => {
    expect(parseLaunch(`?embed=1&lab=blockly&template=${key}`)).toEqual({ mode: 'invalid', problem: `The template "${key}" does not open in lab=blockly.`, lab: 'blockly' });
    expect(parseLaunch(`?embed=1&lab=yolobit&template=${key}`)).toEqual({ mode: 'invalid', problem: `The template "${key}" does not open in lab=yolobit.`, lab: 'yolobit' });
    expect(parseLaunch(`?embed=1&template=${key}`)).toEqual({ mode: 'invalid', problem: `The template "${key}" opens only in lab=robot: add lab=robot.` });
  });

  it('refuses a robot level for the Blockly lab, as any profile there', () => {
    expect(parseLaunch('?embed=1&lab=blockly&template=blink&profile=uno-basic')).toEqual({ mode: 'invalid', problem: 'profile is only for lab=yolobit or lab=robot.', lab: 'blockly' });
  });

  it('refuses a robot level for the Yolo:Bit lab, and a Yolo:Bit level for the robot lab', () => {
    expect(parseLaunch('?embed=1&lab=yolobit&template=ybc-heart&profile=uno-basic')).toEqual({
      mode: 'invalid',
      problem: 'Unknown profile "uno-basic": use ybc-basic or ybc-advanced.',
      lab: 'yolobit',
    });
  });

  it('keeps the legacy launch as it was: it still opens every key it had, and no robot scenario', () => {
    expect(parseLaunch('?embed=1&template=ybc-heart')).toEqual({ mode: 'embed', template: 'ybc-heart' });
    expect(parseLaunch('?embed=1&template=blink&lab=robot')).toMatchObject({ mode: 'invalid', lab: 'robot' });
  });

  describe('a profile lower than the scenario needs', () => {
    afterEach(() => {
      scenario.needs = undefined;
    });

    it('is an error screen of the robot lab, never a project', () => {
      scenario.needs = 'uno-advanced';
      expect(parseLaunch(`?embed=1&lab=robot&template=rb-servo-gate&profile=uno-basic&origin=${host}`)).toEqual({
        mode: 'invalid',
        problem: 'The template "rb-servo-gate" needs profile=uno-advanced: it uses blocks or parts that uno-basic does not have.',
        lab: 'robot',
      });
      // The profile of the scenario, or a higher one, or none (the scenario's own) opens.
      expect(parseLaunch(`?embed=1&lab=robot&template=rb-servo-gate&profile=uno-advanced&origin=${host}`)).toMatchObject({ mode: 'embed', lab: robot('uno-advanced') });
      expect(parseLaunch(`?embed=1&lab=robot&template=rb-servo-gate&origin=${host}`)).toMatchObject({ mode: 'embed', lab: robot(null) });
    });

    it('is not one while the scenario needs the Basic board, which is every scenario today', () => {
      expect(parseLaunch(`?embed=1&lab=robot&template=rb-servo-gate&profile=uno-basic&origin=${host}`)).toMatchObject({ mode: 'embed', lab: robot('uno-basic') });
    });
  });

  it('says the new problems in Vietnamese on the error screen', () => {
    const say = (search: string) => {
      const launch = parseLaunch(search);
      if (launch.mode !== 'invalid') {
        throw new Error(`${search} is not a broken launch`);
      }
      return localizeLaunchProblem(launch.problem, 'vi');
    };
    expect(say('?embed=1&template=rb-sandbox')).toBe('Mẫu bài "rb-sandbox" chỉ mở trong lab=robot: thêm lab=robot.');
    expect(say('?embed=1&lab=robot&template=rb-sandbox&profile=ybc-basic')).toBe('Không có cấp độ "ybc-basic": dùng uno-basic hoặc uno-advanced.');
    expect(say('?embed=1&lab=blockly&template=rb-sandbox')).toBe('Mẫu bài "rb-sandbox" không mở trong lab=blockly.');
    expect(say('?embed=1&lab=scratch&template=rb-sandbox')).toBe('Không có lab "scratch": dùng lab=blockly, lab=yolobit hoặc lab=robot.');
    expect(say('?embed=1&lab=blockly&template=blink&profile=uno-basic')).toBe('Tham số profile chỉ dùng với lab=yolobit hoặc lab=robot.');
    expect(localizeLaunchProblem('The template "rb-servo-gate" needs profile=uno-advanced: it uses blocks or parts that uno-basic does not have.', 'vi')).toBe(
      'Mẫu bài "rb-servo-gate" cần mức Nâng cao (profile=uno-advanced): bài dùng khối hoặc linh kiện mà mức Cơ bản không có.',
    );
  });
});
