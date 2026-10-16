import type { Challenge, GoalSpec, InputStep } from '../core/challenge';
import type { TemplateKey } from './templates';
import { ybcImages } from './ybc-templates';

// The challenge of each template (N6a S2): what "Kiểm tra" / Check asks of the learner's program. Template data,
// like the documents: the key is the contract, and the goals may be refined without changing it. Labels are in
// both languages of the UI; the host shows the ones the lab sends (stem-lab/v1 `ready`, `check-result`).
// The empty templates have no challenge: a lab on them has nothing to check (an author leaves requiresCheck off).

/** The languages of the lab's UI (src/ui/i18n). */
export type ChallengeLanguage = 'en' | 'vi';

type Text = Readonly<Record<ChallengeLanguage, string>>;
type GoalData = GoalSpec & { id: string; label: Text };
type ChallengeData = { durationMs: number; inputScript?: readonly InputStep[]; goals: readonly GoalData[] };

const hold = (closed: boolean) => ({ kind: 'hold', closed }) as const;
const slider = (value: number) => ({ kind: 'slider', value }) as const;

/** The push button of the generic samples, held from 300 ms to 900 ms. */
const pressButton: readonly InputStep[] = [
  { atMs: 300, componentId: 'button', input: hold(true) },
  { atMs: 900, componentId: 'button', input: hold(false) },
];

const ledFollowsButton: GoalData = {
  id: 'led-follows-button',
  kind: 'led-blinks',
  componentId: 'led',
  minToggles: 2,
  label: { vi: 'Đèn sáng khi bấm nút và tắt khi thả nút', en: 'The LED lights while the button is held and goes off when released' },
};

const challenges: Readonly<Record<TemplateKey, ChallengeData | null>> = {
  'led-on': {
    durationMs: 1000,
    goals: [
      { id: 'led-lit', kind: 'led-lit', componentId: 'led', label: { vi: 'Đèn LED sáng', en: 'The LED lights up' } },
      { id: 'uses-digital-write', kind: 'uses-block', blockType: 'stem_digital_write', label: { vi: 'Dùng khối ghi chân số', en: 'Uses the digital write block' } },
    ],
  },
  blink: {
    durationMs: 3500,
    goals: [
      { id: 'led-blinks', kind: 'led-blinks', componentId: 'led', minToggles: 3, label: { vi: 'Đèn LED nhấp nháy (sáng, tắt, sáng lại)', en: 'The LED blinks (on, off, on again)' } },
      { id: 'uses-wait', kind: 'uses-block', blockType: 'stem_wait', label: { vi: 'Dùng khối chờ', en: 'Uses the wait block' } },
    ],
  },
  'button-direct': { durationMs: 1200, inputScript: pressButton, goals: [ledFollowsButton] },
  'button-led': {
    durationMs: 1200,
    inputScript: pressButton,
    goals: [
      ledFollowsButton,
      { id: 'uses-if', kind: 'uses-block', blockType: 'controls_if', label: { vi: 'Dùng khối nếu… thì… nếu không thì', en: 'Uses the if… else block' } },
    ],
  },
  empty: null,
  'ybc-heart': {
    durationMs: 1000,
    goals: [{ id: 'shows-heart', kind: 'display-shows', frame: ybcImages.heart, label: { vi: 'Màn hình hiện hình trái tim', en: 'The display shows a heart' } }],
  },
  'ybc-button-ab': {
    durationMs: 1500,
    inputScript: [
      { atMs: 200, part: 'button-a', input: hold(true) },
      { atMs: 500, part: 'button-a', input: hold(false) },
      { atMs: 800, part: 'button-b', input: hold(true) },
      { atMs: 1100, part: 'button-b', input: hold(false) },
    ],
    goals: [
      { id: 'a-shows-check', kind: 'display-shows', frame: ybcImages.check, fromMs: 200, label: { vi: 'Nhấn nút A thì hiện dấu ✓', en: 'Button A shows ✓' } },
      { id: 'b-shows-cross', kind: 'display-shows', frame: ybcImages.cross, fromMs: 800, label: { vi: 'Nhấn nút B thì hiện dấu ✗', en: 'Button B shows ✗' } },
    ],
  },
  'ybc-night-light': {
    durationMs: 1500,
    inputScript: [
      { atMs: 300, part: 'light', input: slider(10) },
      { atMs: 1000, part: 'light', input: slider(80) },
    ],
    goals: [
      { id: 'dark-lights-up', kind: 'display-shows', frame: ybcImages.full, fromMs: 300, label: { vi: 'Trời tối (ánh sáng dưới 30) thì màn hình sáng', en: 'In the dark (light below 30) the display lights up' } },
      { id: 'bright-goes-off', kind: 'display-shows', frame: '00000:00000:00000:00000:00000', fromMs: 1100, label: { vi: 'Trời sáng thì màn hình tắt', en: 'In bright light the display goes off' } },
    ],
  },
  'ybc-melody': {
    durationMs: 2000,
    inputScript: [
      { atMs: 200, part: 'button-a', input: hold(true) },
      { atMs: 400, part: 'button-a', input: hold(false) },
    ],
    goals: [{ id: 'a-plays-notes', kind: 'buzzer-played', minNotes: 3, label: { vi: 'Nhấn nút A thì phát ít nhất 3 nốt nhạc', en: 'Button A plays at least 3 notes' } }],
  },
  'ybc-empty': null,
};

/** The challenge of `key` with its labels in `language`, or null when the template has none. */
export function templateChallenge(key: TemplateKey, language: ChallengeLanguage): Challenge | null {
  const data = challenges[key];
  if (!data) {
    return null;
  }
  return {
    durationMs: data.durationMs,
    ...(data.inputScript ? { inputScript: data.inputScript } : {}),
    goals: data.goals.map((goal) => ({ ...goal, label: goal.label[language] })),
  };
}
