// ir-digital on port IR1 as irClaw
// libraries: arduino:avr@1.8.8 (LGPL-2.1)
#define IR_CLAW_PIN A3
// ir.detect (U-37), read
//   setup: pinMode(IR_CLAW_PIN, INPUT);
(digitalRead(IR_CLAW_PIN) == LOW)
