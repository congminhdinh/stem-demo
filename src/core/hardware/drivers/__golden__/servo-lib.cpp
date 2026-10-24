// servo-lib on port SV1 as servo1
// libraries: arduino:avr@1.8.8 (LGPL-2.1), Servo@1.3.0 (LGPL-2.1)
#include <Servo.h>
#define SERVO1_PIN 9
Servo servo1;
void servoSet(Servo &servo, long angle) {
  if (angle < 0L) angle = 0L;
  if (angle > 180L) angle = 180L;
  servo.write((int)angle);
}
// servo.set (U-23), call
//   setup: servo1.attach(SERVO1_PIN);
//   setup: servo1.write(90);
servoSet(servo1, 45L);
