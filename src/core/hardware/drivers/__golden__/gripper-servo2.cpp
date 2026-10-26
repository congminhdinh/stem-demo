// gripper-servo2 on port GR1 as gripper
// libraries: arduino:avr@1.8.8 (LGPL-2.1), Servo@1.3.0 (LGPL-2.1)
#include <Servo.h>
#define GRIPPER_CLAW 9
#define GRIPPER_LIFT 10
Servo gripperClaw;
Servo gripperLift;
void gripperSet(Servo &servo, long angle) {
  if (angle < 0L) angle = 0L;
  if (angle > 90L) angle = 90L;
  servo.write((int)angle);
}
// gripper.claw (U-35), call
//   setup: gripperClaw.attach(GRIPPER_CLAW);
//   setup: gripperClaw.write(0);
//   setup: gripperLift.attach(GRIPPER_LIFT);
//   setup: gripperLift.write(90);
gripperSet(gripperClaw, 80L);
// gripper.lift (U-36), call
gripperSet(gripperLift, 0L);
