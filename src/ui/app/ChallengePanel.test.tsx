// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Challenge } from '../../core/challenge';
import { TextProvider } from '../i18n/text';
import { ChallengePanel, type CheckView } from './ChallengePanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const challenge: Challenge = {
  durationMs: 1000,
  goals: [
    { id: 'heart', label: 'Màn hình hiện hình trái tim', kind: 'display-shows', frame: '01010:11111:11111:01110:00100' },
    { id: 'show', label: 'Dùng khối hiển thị hình', kind: 'uses-block', blockType: 'ybc_display_show_image' },
  ],
};

async function render(check: CheckView) {
  await act(async () =>
    root.render(
      <TextProvider locale="vi">
        <ChallengePanel challenge={challenge} check={check} />
      </TextProvider>,
    ),
  );
  const goals = [...container.querySelectorAll('li')].map((item) => [item.dataset.testid, item.dataset.state, item.textContent]);
  return { goals, status: container.querySelector('[role="status"]')?.textContent };
}

describe('ChallengePanel (N6a S4)', () => {
  it('lists the goals, none checked yet', async () => {
    expect(await render({ state: 'idle' })).toEqual({
      goals: [
        ['goal-heart', 'todo', '○Màn hình hiện hình trái tim, chưa kiểm tra'],
        ['goal-show', 'todo', '○Dùng khối hiển thị hình, chưa kiểm tra'],
      ],
      status: '',
    });
  });

  it('says a check is running', async () => {
    expect((await render({ state: 'checking' })).status).toBe('Đang kiểm tra: chương trình của bạn được chạy thử vài giây…');
  });

  it('marks each goal and says the check passed', async () => {
    const result = { passed: true, goals: challenge.goals.map(({ id, label }) => ({ id, label, passed: true })) };
    expect(await render({ state: 'done', result, started: true })).toEqual({
      goals: [
        ['goal-heart', 'passed', '✓Màn hình hiện hình trái tim, đạt'],
        ['goal-show', 'passed', '✓Dùng khối hiển thị hình, đạt'],
      ],
      status: 'Đạt! Bạn đã hoàn thành mọi mục tiêu.',
    });
  });

  it('marks the goals not met, and says what to do', async () => {
    const result = { passed: false, goals: [{ id: 'heart', label: 'x', passed: false }, { id: 'show', label: 'y', passed: true }] };
    expect(await render({ state: 'done', result, started: true })).toEqual({
      goals: [
        ['goal-heart', 'failed', '✗Màn hình hiện hình trái tim, chưa đạt'],
        ['goal-show', 'passed', '✓Dùng khối hiển thị hình, đạt'],
      ],
      status: 'Chưa đạt: xem các mục tiêu chưa đạt, sửa chương trình rồi kiểm tra lại.',
    });
  });

  it('says the program did not run when the check could not start it', async () => {
    const result = { passed: false, goals: challenge.goals.map(({ id, label }) => ({ id, label, passed: false })) };
    expect((await render({ state: 'done', result, started: false })).status).toBe(
      'Chương trình chưa chạy được: sửa lỗi được báo ở thanh trên rồi kiểm tra lại.',
    );
  });
});
