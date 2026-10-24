// R0.4 sketch 3: servo on D9 + HC-SR04 on TRIG=D12 / ECHO=D11 (ref-uno-rover@0).
// The harness answers each trigger with a scripted echo. D13 (PB5) marks each pulseIn call: HIGH at the
// call, LOW at its return, written straight to the port (2 cycles) so the mark costs nothing measurable.
#include <Servo.h>
#define SERVO_PIN 9
#define TRIG 12
#define ECHO 11

Servo servo1;
const int angles[] = {90, 0, 180, 45, 90, 135, 90};

long ultrasonicCm(long *rawUs) {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  PORTB |= _BV(PB5);
  long us = (long)pulseIn(ECHO, HIGH, 30000UL);
  PORTB &= ~_BV(PB5);
  *rawUs = us;
  if (us == 0L) return 400L;
  long cm = us / 58L;
  if (cm < 2L) cm = 2L;
  if (cm > 400L) cm = 400L;
  return cm;
}

void setup() {
  Serial.begin(9600);
  pinMode(13, OUTPUT);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  servo1.attach(SERVO_PIN);
}

void loop() {
  static uint8_t i = 0;
  if (i < 7) {
    servo1.write(angles[i]);
    long raw;
    long cm = ultrasonicCm(&raw);
    Serial.print(angles[i]);
    Serial.print(' ');
    Serial.print(raw);
    Serial.print(' ');
    Serial.println(cm);
    i++;
  }
  delay(60);
}
