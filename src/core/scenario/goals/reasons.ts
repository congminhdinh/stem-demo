// Why a goal is not met (N18 R6.1). A goal that has not passed gives one of these as the `reasonKey` of its result; a goal that has
// passed gives none. Each is a key of the UI's messages (`src/ui/i18n/messages.ts`, in both languages): the core cannot hold the words
// (boundary B1), so it hands the UI the key and the UI says it, with the time (`atS`) and the run (R6.3) around it. A UI test
// (goal-reasons.test.ts) holds the two lists together: a reason added here without a text fails it.

export const goalReasons = {
  /** The robot left the arena before the goal was met (every goal that depends on where things are). */
  outOfArena: 'robot.goal.reason.out-of-arena',
  /** `avoid-contact`: the robot touched a collider with the tag. */
  contact: 'robot.goal.reason.contact',
  /** `reach-zone`: the middle of the robot never was in the zone. */
  zoneNotReached: 'robot.goal.reason.zone-not-reached',
  /** `checkpoints-in-order`: a checkpoint was entered before the ones that come first, and the route was never done. */
  checkpointOutOfOrder: 'robot.goal.reason.checkpoint-out-of-order',
  /** `checkpoints-in-order`: the robot did not go through every checkpoint, and entered none out of order. */
  checkpointMissed: 'robot.goal.reason.checkpoint-missed',
  /** `avoid-contact` and `stay-on-line`, the guard goals: the robot never got as far from its start as lets them pass (travel.ts). */
  robotDidNotMove: 'robot.goal.reason.robot-did-not-move',
  /** `stay-on-line`: the robot was over the tape for too little of the distance it drove. */
  offLine: 'robot.goal.reason.off-line',
  /** `object-in-zone`: the object is not in the zone at the end. */
  objectNotInZone: 'robot.goal.reason.object-not-in-zone',
  /** `stop-in-zone`: at the end of the run the robot had not been standing still in the zone for long enough. */
  notStoppedInZone: 'robot.goal.reason.not-stopped-in-zone',
  /** `servo-angle` without a zone: the servo was never held at the angle for long enough. */
  servoOutOfRange: 'robot.goal.reason.servo-out-of-range',
  /** `servo-angle` with a zone: the servo was never held at the angle, in the zone, for long enough. */
  servoNotSetInZone: 'robot.goal.reason.servo-not-set-in-zone',
  /** `finish-within`: the other goals were not all met in time. */
  notFinishedInTime: 'robot.goal.reason.not-finished-in-time',
  /** `uses-block`: the program that runs does not have the block. */
  blockNotUsed: 'robot.goal.reason.block-not-used',
  /**
   * N18 R5.2a fix round 2 (controller ruling): the run ended at the robot's first contact with a collider of the scenario's `endOnContact`
   * before the goal had the hold or the stop it needs (`stop-in-zone`, `servo-angle`). The check (R6.2) gives it; no goal reads contacts for it.
   */
  runEndedContact: 'robot.goal.reason.run-ended-contact',
  /**
   * N18 R6.2 fix round 1 (controller ruling): the run ended in an error (a fault of the program, or of the simulation), so the check (R6.2)
   * fails every goal of that variant with it, however far the frozen world got. No goal gives it.
   */
  programError: 'robot.goal.reason.program-error',
} as const;

export type GoalReasonKey = (typeof goalReasons)[keyof typeof goalReasons];

/** Every reason, in the order above. */
export const goalReasonKeys: readonly GoalReasonKey[] = Object.values(goalReasons);
