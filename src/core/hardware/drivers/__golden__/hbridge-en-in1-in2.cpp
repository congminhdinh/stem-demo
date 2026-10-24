// hbridge-en-in1-in2 on port M1 as motorLeft
// libraries: arduino:avr@1.8.8 (LGPL-2.1)
#define MOTOR_LEFT_EN 5
#define MOTOR_LEFT_IN1 7
#define MOTOR_LEFT_IN2 8
void motorSet(uint8_t en, uint8_t in1, uint8_t in2, long speed) {
  if (speed > 100L) speed = 100L;
  if (speed < -100L) speed = -100L;
  long magnitude = speed < 0L ? -speed : speed;
  digitalWrite(in1, speed > 0L ? HIGH : LOW);
  digitalWrite(in2, speed < 0L ? HIGH : LOW);
  analogWrite(en, (int)((magnitude * 255L + 50L) / 100L));
}
// motor.set (U-20), call
//   setup: pinMode(MOTOR_LEFT_EN, OUTPUT);
//   setup: pinMode(MOTOR_LEFT_IN1, OUTPUT);
//   setup: pinMode(MOTOR_LEFT_IN2, OUTPUT);
motorSet(MOTOR_LEFT_EN, MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, 50L);
