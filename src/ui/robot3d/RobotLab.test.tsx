// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { robotTemplateKeys } from '../../samples/robot-templates';
import { TextProvider } from '../i18n/text';
import RobotLab from './RobotLab';

// The shell of the robot lab (N18 R4.1): the title, the scenario, a viewport to put the scene in, and the program it is given.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const render = (node: ReactNode, locale: 'en' | 'vi' = 'vi') => act(() => root.render(<TextProvider locale={locale}>{node}</TextProvider>));

describe('RobotLab (N18 R4.1)', () => {
  it('says the lab and the scenario in Vietnamese, and holds a labelled viewport and the program', () => {
    render(<RobotLab template="rb-drive-to-zone" program={<section data-testid="program">chương trình</section>} />);

    expect(host.querySelector('h1')?.textContent).toBe('Robot 3D');
    expect(host.querySelector('[data-testid=robot-scenario]')?.textContent).toBe('Chạy tới vùng đích');
    const viewport = host.querySelector('[data-testid=robot-viewport]');
    expect(viewport?.getAttribute('aria-label')).toBe('Khung nhìn robot');
    expect(viewport?.textContent).toBe('Khung nhìn 3D của robot sẽ hiện ở đây.');
    expect(host.querySelector('[data-testid=program]')?.textContent).toBe('chương trình');
    expect(host.querySelector('[data-testid=robot-lab]')?.getAttribute('data-scenario')).toBe('rb-drive-to-zone');
  });

  it('titles every scenario in its own words, and in English when the lab is read in English', () => {
    render(<RobotLab template="rb-sandbox" program={null} />, 'en');
    expect(host.querySelector('[data-testid=robot-scenario]')?.textContent).toBe('Free sandbox');
    const titles = robotTemplateKeys.map((key) => {
      render(<RobotLab template={key} program={null} />);
      return host.querySelector('[data-testid=robot-scenario]')?.textContent;
    });
    expect(new Set(titles).size).toBe(robotTemplateKeys.length);
  });

  it('draws nothing in 3D: there is no canvas in the shell', () => {
    render(<RobotLab template="rb-sandbox" program={null} />);
    expect(host.querySelector('canvas')).toBeNull();
  });
});
