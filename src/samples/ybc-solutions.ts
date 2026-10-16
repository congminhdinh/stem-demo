import { projectDocumentSchema, type ProjectDocument } from '../core/circuit/document';
import {
  buttonPressed,
  clearDisplay,
  ifBlock,
  lightBelow,
  melodyNotes,
  showImage,
  ybcImages,
  ybcProgram,
  ybcProject,
  type YbcTemplateKey,
} from './ybc-templates';

// The finished programs of the Yolo:Bit starters (tests and E2E only; the app never imports this file): each is
// its starter with the loose block attached where the lesson asks, so the template's challenge passes.

export type YbcLessonKey = Exclude<YbcTemplateKey, 'ybc-empty'>;

const solutions: Readonly<Record<YbcLessonKey, () => unknown>> = {
  'ybc-heart': () => ybcProject('ybc-heart', 'Trái tim', ybcProgram({ onStart: [showImage('heart', ybcImages.heart)], forever: [] })),
  'ybc-button-ab': () =>
    ybcProject(
      'ybc-button-ab',
      'Nút A/B',
      ybcProgram({
        onStart: [],
        forever: [
          ifBlock('if-buttons', [
            [buttonPressed('pressed-a', 'A'), [showImage('show-check', ybcImages.check)]],
            [buttonPressed('pressed-b', 'B'), [showImage('show-cross', ybcImages.cross)]],
          ]),
        ],
      }),
    ),
  'ybc-night-light': () =>
    ybcProject(
      'ybc-night-light',
      'Đèn ngủ',
      ybcProgram({
        onStart: [],
        forever: [ifBlock('if-dark', [[lightBelow('dark', 30), [showImage('show-full', ybcImages.full)]]], [clearDisplay('clear')])],
      }),
    ),
  'ybc-melody': () =>
    ybcProject(
      'ybc-melody',
      'Giai điệu',
      ybcProgram({ onStart: [], forever: [ifBlock('if-a', [[buttonPressed('pressed-a', 'A'), melodyNotes('melody')]])] }),
    ),
};

/** The finished project of a Yolo:Bit lesson template, new on every call. */
export const ybcSolutionDocument = (key: YbcLessonKey): ProjectDocument => projectDocumentSchema.parse(solutions[key]());
