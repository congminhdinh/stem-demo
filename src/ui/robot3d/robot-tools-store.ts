import { createStore } from 'zustand/vanilla';
import { GRIPPER_ANGLE, GRIPPER_START, type DriveDirection } from '../../core/hardware/drivers';
import type { Kit } from '../../core/hardware/kit';
import { checkPlacement, robotOutlineCm, type PlacementPose } from '../../core/scenario/placement';
import type { Scenario } from '../../core/scenario/scenario';
import { isRunOver, type RobotRunStore } from './robot-run-store';
import { dragPose, gripperLimits, onRobot, rulerTargets, sensorBarCm, snapPoint, type ArenaPoint, type GripperAction, type SnapKind } from './robot-tools';

// The robot lab's view tools (N18 R4.8), as one store the 3D view (FloorPicker), the 2D map (TopViewTools) and the tool strip
// (RobotTools) share: the views turn the pointer into arena points and call `pick`, `grab`, `drag` and `drop`; the strip turns the tools
// on and off and holds the teleop speed. One tool at a time:
//   - the ruler ("Thước đo"): two picks make a segment (a third starts again), each snapped near the robot's middle or its sensor bar;
//     turning the tool off or Esc clears it;
//   - the move tool ("Di chuyển robot"): with no run going on (one that is over gives way), a press on the robot grabs it, the drag moves a
//     ghost (moved back inside the arena; `clear` false, a red ghost, where the robot would stand in something), and the drop places it
//     there (the run store's placeRobot, which the session checks again). Q and E turn it TURN_STEP_DEG, during a drag too; Esc puts it
//     back at the lesson's start. By the keyboard (fix round 1): the arrows nudge a ghost from where the robot stands (`nudge`), Q/E turn
//     that ghost, Enter places it (`commit`), Esc drops it first. A check (the lock) moves nothing.
//   - A replay of a check's round is the check's: no tool turns on and none takes a point meanwhile (fix round 1).
//   - teleop's direction held (`hold`, by the keys or the pad): sent to the run store as a move at the speed of the slider, a stop when let
//     go, and sent again when the speed changes while it is held. Nothing is held while teleop is off.
//   - N19 E3, the gripper car's claw and lift (`moveGripper`, by the keys Q E R F or the four buttons): sent to the run store as a gripper
//     command with the angle it was last told, plus a step (the lift, 0..90) or the claw's open or closed angle. What it was told is
//     `gripper`, back at setup()'s angles (the driver's `GRIPPER_START`) with each new teleop world; the lift's range is the driver's `GRIPPER_ANGLE`.
// The robot's pose is the one the view shows (the run store's latestWorld), else the scenario's start.

/** The teleop speed slider (%): from just above the kit's dead band (about 31 %) to full speed, 50 % at first. */
export const TELEOP_SPEED = { min: 30, max: 100, step: 5, initial: 50 } as const;

export type RobotTool = 'ruler' | 'move';

/** A point of the ruler, and what it snapped to. */
export type RulerPoint = { readonly point: ArenaPoint; readonly snap: SnapKind | null };

export type RobotToolsState = {
  tool: RobotTool | null;
  /** The ruler's points: none, the first, or both. */
  ruler: readonly RulerPoint[];
  /** The move tool's robot while it is dragged or turned where it cannot go: where it would stand, and whether it may. */
  ghost: { readonly pose: PlacementPose; readonly clear: boolean } | null;
  /** The speed teleop drives at, %. */
  speed: number;
  /** Teleop: the direction the learner holds now (a key or the pad); null when the robot is told to stop. */
  held: DriveDirection | null;
  /** N19 E3: the angles the claw and the lift were last told in this teleop world (setup()'s until a command). */
  gripper: { readonly clawDeg: number; readonly liftDeg: number };
  /** N18 R4.3: the sensor overlays ("Hiện cảm biến") are shown, in the 3D view and on the 2D map. On until the learner turns them off, in a check too. */
  sensors: boolean;
  setSensors(on: boolean): void;
  setTool(tool: RobotTool | null): void;
  /** A click on the mat at `point` with the ruler. */
  pick(point: ArenaPoint): void;
  clearRuler(): void;
  /** A press on the mat at `point` with the move tool: true when it grabbed the robot (the view then follows the pointer). */
  grab(point: ArenaPoint): boolean;
  drag(point: ArenaPoint): void;
  /** The pointer let go: the robot is placed where the ghost is, when it may stand there. */
  drop(): Promise<void>;
  cancelDrag(): void;
  /** Q (+) and E (−): turns the robot, or the ghost being dragged or nudged, by `stepDeg`. */
  turn(stepDeg: number): Promise<void>;
  /** The arrows with the move tool: moves the ghost (from where the robot stands) by (dx, dy) cm of the arena. */
  nudge(dxCm: number, dyCm: number): void;
  /** Enter with the move tool: places the robot where the nudged ghost is, when it may stand there. */
  commit(): Promise<void>;
  /** Back at the lesson's start (the move tool's Esc and "Về vị trí xuất phát"). */
  toStart(): Promise<void>;
  /** Esc in the view: the ruler clears, the move tool goes back to the start. */
  escape(): Promise<void>;
  setSpeed(speed: number): void;
  /** Teleop: drive `direction` at the speed, or stop (null); nothing while teleop is off. */
  hold(direction: DriveDirection | null): void;
  /** Teleop: nothing is held any more (teleop went off, the view lost the focus); tells the robot nothing. */
  release(): void;
  /**
   * N19 E3: moves the gripper's claw or lift; true when a command was sent (teleop is on and the kit has a gripper), false for nothing. The
   * lift is kept within 0..90 and in whole degrees.
   */
  moveGripper(action: GripperAction): boolean;
  /** N19 E3: forgets what the gripper was told (a new teleop world starts as setup() leaves it). */
  resetGripper(): void;
};

export type RobotToolsStoreOptions = {
  runStore: RobotRunStore;
  scenario: Pick<Scenario, 'arena' | 'start'>;
  kit: Kit;
};

export function createRobotToolsStore({ runStore, scenario, kit }: RobotToolsStoreOptions) {
  const outline = robotOutlineCm(kit);
  const bar = sensorBarCm(kit);
  const limits = gripperLimits(kit);
  return createStore<RobotToolsState>()((set, get) => {
    /** The drag under way: the robot's pose when it was grabbed, and where. */
    let grabbed: { from: PlacementPose; at: ArenaPoint } | null = null;

    /** The robot as the view shows it. */
    const robotPose = (): PlacementPose => {
      const robot = runStore.getState().latestWorld()?.robot;
      return robot ? { xCm: robot.xCm, yCm: robot.yCm, yawDeg: robot.yawDeg } : { ...scenario.start };
    };
    /** A check holds the lab, or a replay of a check's round goes on: no tool is the learner's then. */
    const held = () => {
      const state = runStore.getState();
      return state.locked || (state.round !== null && state.active && !isRunOver(state.snapshot));
    };
    /** The robot may be moved: no check holds the lab, no start is building, and no run goes on (one that is over gives way). */
    const movable = () => {
      const state = runStore.getState();
      return !state.locked && !state.starting && (!state.active || isRunOver(state.snapshot));
    };
    const checked = (pose: PlacementPose) => {
      const placed = checkPlacement(scenario.arena, kit, pose);
      return { pose: placed.pose, clear: placed.issues.length === 0 };
    };

    return {
      tool: null,
      ruler: [],
      ghost: null,
      speed: TELEOP_SPEED.initial,
      held: null,
      gripper: { ...GRIPPER_START },
      sensors: true,

      setSensors(on) {
        if (on !== get().sensors) set({ sensors: on });
      },

      setTool(tool) {
        if (tool === get().tool || (tool !== null && held())) return;
        grabbed = null;
        set({ tool, ruler: [], ghost: null });
      },

      pick(point) {
        if (get().tool !== 'ruler' || held()) return;
        const snapped = snapPoint(point, rulerTargets(robotPose(), bar));
        const ruler = get().ruler;
        set({ ruler: ruler.length >= 2 ? [snapped] : [...ruler, snapped] });
      },

      clearRuler() {
        set({ ruler: [] });
      },

      grab(point) {
        const from = robotPose();
        if (get().tool !== 'move' || !movable() || !onRobot(point, from, outline)) return false;
        grabbed = { from, at: point };
        set({ ghost: { pose: from, clear: true } });
        return true;
      },

      drag(point) {
        if (grabbed === null) return;
        const yawDeg = get().ghost?.pose.yawDeg ?? grabbed.from.yawDeg;
        set({ ghost: checked({ ...dragPose(grabbed.from, grabbed.at, point), yawDeg }) });
      },

      async drop() {
        if (grabbed === null) return;
        grabbed = null;
        const ghost = get().ghost;
        if (ghost !== null && ghost.clear && movable()) {
          await runStore.getState().placeRobot(ghost.pose);
        }
        set({ ghost: null });
      },

      cancelDrag() {
        grabbed = null;
        set({ ghost: null });
      },

      async turn(stepDeg) {
        if (get().tool !== 'move' || !movable()) return;
        const ghost = get().ghost;
        if (ghost !== null) {
          set({ ghost: checked({ ...ghost.pose, yawDeg: ghost.pose.yawDeg + stepDeg }) });
          return;
        }
        const pose = robotPose();
        const turned = checked({ ...pose, yawDeg: pose.yawDeg + stepDeg });
        if (!turned.clear) {
          // Where it cannot turn, the red ghost says so until the next try.
          set({ ghost: turned });
          return;
        }
        set({ ghost: null });
        await runStore.getState().placeRobot(turned.pose);
      },

      nudge(dxCm, dyCm) {
        if (get().tool !== 'move' || grabbed !== null || !movable()) return;
        const from = get().ghost?.pose ?? robotPose();
        set({ ghost: checked({ xCm: from.xCm + dxCm, yCm: from.yCm + dyCm, yawDeg: from.yawDeg }) });
      },

      async commit() {
        const ghost = get().ghost;
        if (get().tool !== 'move' || grabbed !== null || ghost === null || !ghost.clear || !movable()) return;
        await runStore.getState().placeRobot(ghost.pose);
        set({ ghost: null });
      },

      async toStart() {
        grabbed = null;
        set({ ghost: null });
        if (movable() && runStore.getState().placement !== null) {
          await runStore.getState().placeRobot(null);
        }
      },

      async escape() {
        const { tool } = get();
        if (tool === 'ruler') get().clearRuler();
        else if (tool === 'move' && grabbed === null && get().ghost !== null) set({ ghost: null });
        else if (tool === 'move') await get().toStart();
      },

      setSpeed(speed) {
        const next = Math.min(TELEOP_SPEED.max, Math.max(TELEOP_SPEED.min, Math.round(speed)));
        if (next === get().speed) return;
        set({ speed: next });
        const { held } = get();
        if (held !== null) get().hold(held);
      },

      hold(direction) {
        if (!runStore.getState().teleop) {
          set({ held: null });
          return;
        }
        set({ held: direction });
        runStore.getState().teleopCommand(direction === null ? { op: 'stop' } : { op: 'move', direction, speed: get().speed });
      },

      release() {
        set({ held: null, gripper: { ...GRIPPER_START } });
      },

      moveGripper(action) {
        if (limits === null || !runStore.getState().teleop) return false;
        const { gripper } = get();
        if (action.part === 'claw') {
          const deg = action.to === 'open' ? limits.clawOpenDeg : limits.clawClosedDeg;
          set({ gripper: { ...gripper, clawDeg: deg } });
          runStore.getState().teleopCommand({ op: 'gripper', part: 'claw', deg });
        } else {
          const deg = Math.min(GRIPPER_ANGLE.max, Math.max(GRIPPER_ANGLE.min, Math.round(gripper.liftDeg + action.stepDeg)));
          set({ gripper: { ...gripper, liftDeg: deg } });
          runStore.getState().teleopCommand({ op: 'gripper', part: 'lift', deg });
        }
        return true;
      },

      resetGripper() {
        set({ gripper: { ...GRIPPER_START } });
      },
    };
  });
}

export type RobotToolsStore = ReturnType<typeof createRobotToolsStore>;
