import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';

// The scenario's name in the robot lab's header (N18 R6.3, under the lab's own name). N19 final fix (G1 c2): in a gripper lesson it may be
// shortened with an ellipsis (RobotLab.css `robot-header-shrink-title`), so that Kiểm tra keeps the row of the run's controls. Minor round
// m1: the keyboard and a tap reach its whole text too, not only a pointer's hover. While it is shortened it is a Tab stop, and on focus (a
// tap focuses it) or hover a popover under it shows the whole title; Esc hides that until the title is left (WCAG 1.4.13: dismissable,
// hoverable, it stays while focused). Screen readers read the heading's own text, which is whole: the popover is hidden from them. A rover
// lesson's title is the plain heading it always was.

type ScenarioTitleProps = {
  /** The scenario's name in the learner's language. */
  text: string;
  /** It may be shortened (a gripper lesson); false: the plain heading. */
  shrinks: boolean;
};

export function ScenarioTitle({ text, shrinks }: ScenarioTitleProps) {
  if (!shrinks) {
    return (
      <h2 className="robot-scenario" data-testid="robot-scenario">
        {text}
      </h2>
    );
  }
  return <ShrinkingTitle text={text} />;
}

function ShrinkingTitle({ text }: { text: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  /** The text is wider than the heading's box: the ellipsis shows. */
  const [clipped, setClipped] = useState(false);
  /** Esc hid the popover; it shows again once the title is left. */
  const [dismissed, setDismissed] = useState(false);
  useLayoutEffect(() => {
    const element = heading.current;
    if (element === null) return undefined;
    const measure = () => setClipped(element.scrollWidth > element.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    return () => resize.disconnect();
  }, [text]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && clipped && !dismissed) setDismissed(true);
  };
  const back = () => setDismissed(false);
  return (
    <>
      <h2 ref={heading} className="robot-scenario" data-testid="robot-scenario" {...(clipped ? { tabIndex: 0 } : {})} onKeyDown={onKeyDown} onBlur={back} onMouseLeave={back}>
        {text}
      </h2>
      {clipped && (
        <span className="robot-scenario-full" data-testid="robot-scenario-full" data-dismissed={dismissed} aria-hidden="true">
          {text}
        </span>
      )}
    </>
  );
}
