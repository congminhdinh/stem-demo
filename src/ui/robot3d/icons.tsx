// The robot lab's small icons (N18 R4.4): drawn here, in the button's text colour (currentColor), hidden from screen readers (the
// button's text names it). No icon font, nothing loaded.

type IconName = 'run' | 'stop' | 'pause' | 'resume' | 'step' | 'reset' | 'orbit' | 'follow' | 'top' | 'sound' | 'muted' | 'check' | 'replay' | 'recenter';

const paths: Readonly<Record<IconName, string>> = {
  run: 'M5 3.5v9l7.5-4.5z',
  stop: 'M4 4h8v8H4z',
  pause: 'M4.5 3.5h2.5v9H4.5zM9 3.5h2.5v9H9z',
  resume: 'M5 3.5v9l7.5-4.5z',
  step: 'M3.5 3.5v9l6-4.5zM10.5 3.5h2v9h-2z',
  reset: 'M8 3a5 5 0 1 1-4.6 3.1l1.4.6A3.5 3.5 0 1 0 8 4.5V7L4.8 4 8 1z',
  orbit: 'M8 2.5C4.4 2.5 1.5 4.9 1.5 8s2.9 5.5 6.5 5.5 6.5-2.4 6.5-5.5S11.6 2.5 8 2.5zm0 1.5c2.6 0 4.6 1.4 5 3.2H3c.4-1.8 2.4-3.2 5-3.2zm0 8c-2.6 0-4.6-1.4-5-3.2h10c-.4 1.8-2.4 3.2-5 3.2z',
  follow: 'M2 10.5h1.2a1.8 1.8 0 0 0 3.6 0h2.4a1.8 1.8 0 0 0 3.6 0H14V8l-2-3H6.5L4 7.5H2z',
  top: 'M2.5 2.5h11v11h-11zM4 4v8h8V4zM6.5 6.5h3v3h-3z',
  sound: 'M2.5 6h2.5l3.5-3v10L5 10H2.5zM10.5 5.5a3.5 3.5 0 0 1 0 5l-1-1a2 2 0 0 0 0-3zM12 4a5.5 5.5 0 0 1 0 8l-1-1a4 4 0 0 0 0-6z',
  muted: 'M2.5 6h2.5l3.5-3v10L5 10H2.5zM10 6l1-1 1.5 1.5L14 5l1 1-1.5 1.5L15 9l-1 1-1.5-1.5L11 10l-1-1 1.5-1.5z',
  // N18 R6.3: Kiểm tra (a tick) and Xem lại (the reset arrow round a play mark).
  check: 'M6.4 12.2 2.6 8.4l1.3-1.3 2.5 2.5 5.7-5.7 1.3 1.3z',
  replay: 'M8 3a5 5 0 1 1-4.6 3.1l1.4.6A3.5 3.5 0 1 0 8 4.5V7L4.8 4 8 1zM6.8 6.2v3.6L9.8 8z',
  // N18 R4.7, "đặt lại góc nhìn": a frame's four corners round a dot.
  recenter: 'M2 2h4v1.5H3.5V6H2zM10 2h4v4h-1.5V3.5H10zM2 10h1.5v2.5H6V14H2zM12.5 10H14v4h-4v-1.5h2.5zM6.5 6.5h3v3h-3z',
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="robot-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
      <path d={paths[name]} fill="currentColor" />
    </svg>
  );
}
