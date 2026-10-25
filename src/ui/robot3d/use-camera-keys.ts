import { useEffect, type RefObject } from 'react';
import type { CameraCommands } from './camera-commands';
import { cameraKeyOf } from './camera-keys';
import { isTypingTarget } from './robot-tools';

// Reads the camera's keys (camera-keys.ts) in the robot lab's view (N18 R8): on the stage (RobotLab's `.robot-stage`), for a key whose
// target is the stage itself or the 3D view that takes the focus (`[data-view-focus]`), so a button or a slider of the controls
// over the view keeps its keys, and never for a key typed into a field or the block editor. A key somebody else took (the view tools:
// the move tool's Shift + arrows nudge the robot 5 cm, teleop's) is left to them: `defaultPrevented` comes first, so this must listen
// after the tools do (the tools mount below the stage, and their effects run first).

export function useCameraKeys(stage: RefObject<HTMLElement | null>, commands: CameraCommands): void {
  useEffect(() => {
    const element = stage.current;
    if (element === null) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTypingTarget(event.target, event.key)) return;
      const inView = event.target === element || (event.target instanceof Element && event.target.closest('[data-view-focus]') !== null);
      if (!inView) return;
      const command = cameraKeyOf(event);
      if (command === null) return;
      // The arrows and + / − would scroll or zoom the page.
      event.preventDefault();
      commands.emit(command);
    };
    element.addEventListener('keydown', onKeyDown);
    return () => element.removeEventListener('keydown', onKeyDown);
  }, [stage, commands]);
}
