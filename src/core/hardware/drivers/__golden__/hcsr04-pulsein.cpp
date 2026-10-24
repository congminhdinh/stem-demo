// hcsr04-pulsein on port US1 as ultrasonic
// libraries: arduino:avr@1.8.8 (LGPL-2.1)
#define ULTRASONIC_TRIG 12
#define ULTRASONIC_ECHO 11
long ultrasonicCm(uint8_t trig, uint8_t echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(2);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);
  long us = (long)pulseIn(echo, HIGH, 30000UL);
  if (us == 0L) return 400L;
  long cm = us / 58L;
  if (cm < 2L) return 2L;
  if (cm > 400L) return 400L;
  return cm;
}
// ultrasonic.cm (U-27), read
//   setup: pinMode(ULTRASONIC_TRIG, OUTPUT);
//   setup: pinMode(ULTRASONIC_ECHO, INPUT);
ultrasonicCm(ULTRASONIC_TRIG, ULTRASONIC_ECHO)
