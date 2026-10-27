import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { isRobotTemplateKey, robotTemplateKeys } from '../samples/robot-templates';
import { fullSkip, testEdition } from '../../tests/basic-skip';
import { LaunchError } from './app/LaunchError';
import { parseLaunch } from './app/launch';
import { basicRobotTemplates, EDITION, editionHasRobotTemplate, editionOf, editionTemplateProblem, isBasic, isEditionTemplateProblem } from './edition';
import { launchProblemRules, matchingRule } from './i18n/core-text';
import { TextProvider } from './i18n/text';

// demo-basic: the edition switch (edition.ts) and what it decides outside the robot lab's own view: which scenarios a launch opens, and
// what the error screen says of one it does not.

describe('the edition (demo-basic)', () => {
  it('is full only when VITE_STEM_EDITION says so: anything else is this branch’s Basic demo', () => {
    expect(editionOf('full')).toBe('full');
    for (const value of ['basic', undefined, '', 'FULL', 'Full', ' full', 'pro', 1, null]) expect(editionOf(value)).toBe('basic');
  });

  it('is the edition the tests skip by (tests/basic-skip.ts reads the same variable with the same rule)', () => {
    expect(EDITION).toBe(testEdition);
    expect(isBasic()).toBe(testEdition === 'basic');
  });

  it('opens three rover lessons and the sandbox in the Basic demo, every scenario in full', () => {
    expect(basicRobotTemplates).toEqual(['rb-drive-to-zone', 'rb-stop-at-wall', 'rb-line-follow', 'rb-sandbox']);
    for (const key of basicRobotTemplates) expect(isRobotTemplateKey(key)).toBe(true);
    expect(robotTemplateKeys.filter((key) => editionHasRobotTemplate(key, 'basic'))).toEqual([...basicRobotTemplates]);
    expect(robotTemplateKeys.filter((key) => editionHasRobotTemplate(key, 'full'))).toEqual([...robotTemplateKeys]);
  });

  it('says why a scenario is not in the Basic demo, and knows that sentence again', () => {
    expect(editionTemplateProblem('rb-grip-pick', 'basic')).toBe('The scenario "rb-grip-pick" is not in the basic demo.');
    expect(editionTemplateProblem('rb-grip-pick', 'full')).toBeNull();
    expect(editionTemplateProblem('rb-sandbox', 'basic')).toBeNull();
    expect(isEditionTemplateProblem('The scenario "rb-grip-pick" is not in the basic demo.')).toBe(true);
    expect(isEditionTemplateProblem('Unknown template "rb-grip-pick".')).toBe(false);
    // The error screen says it in the lab's words (messages.ts), not by a rule of the parser's sentences: none matches it.
    expect(matchingRule(launchProblemRules, 'The scenario "rb-grip-pick" is not in the basic demo.')).toBe(-1);
  });
});

describe('the error screen of a scenario the Basic demo does not open', () => {
  beforeEach(({ skip }) => fullSkip(skip, 'scenario subset'));

  const screen = (search: string, locale: 'vi' | 'en') => {
    const launch = parseLaunch(search);
    if (launch.mode !== 'invalid') throw new Error(`${search} opens`);
    return renderToStaticMarkup(
      <TextProvider locale={locale}>
        <LaunchError problem={launch.problem} {...(launch.lab ? { lab: launch.lab } : {})} />
      </TextProvider>,
    );
  };

  it('says so in Vietnamese, keeps the parser’s words as the technical detail, and lists the four scenarios it has', () => {
    const markup = screen('?embed=1&lab=robot&template=rb-grip-pick&origin=http://localhost:3000', 'vi');
    expect(markup).toContain('<p>Kịch bản này không có trong bản demo cơ bản.</p>');
    expect(markup).toContain('<p lang="en">The scenario &quot;rb-grip-pick&quot; is not in the basic demo.</p>');
    expect(markup).toContain('Các mẫu được hỗ trợ: rb-drive-to-zone, rb-stop-at-wall, rb-line-follow, rb-sandbox.');
  });

  it('says so in English too', () => {
    const markup = screen('?embed=1&lab=robot&template=rb-mini-mission', 'en');
    expect(markup).toContain('<p>This scenario is not in the basic demo.</p>');
    expect(markup).toContain('Supported templates: rb-drive-to-zone, rb-stop-at-wall, rb-line-follow, rb-sandbox.');
  });

  it('lists only its four scenarios for any other broken robot launch, and every template of the other labs', () => {
    expect(screen('?embed=1&lab=robot&template=rb-unknown', 'en')).toContain('Supported templates: rb-drive-to-zone, rb-stop-at-wall, rb-line-follow, rb-sandbox.');
    expect(screen('?embed=1&lab=yolobit&template=nope', 'en')).toContain('ybc-heart, ybc-button-ab');
  });
});
