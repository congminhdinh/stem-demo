// R0.4 extra sketch: every module of ref-uno-rover@0 at once, to see that they coexist on the timers.
// Servo D9 (Timer1), buzzer tone D10 (Timer2 ISR), motors EN D5/D6 (Timer0 PWM), IN D7 D8 D4 D2,
// ultrasonic TRIG D12 / ECHO D11, LED D13, button D3 (INPUT_PULLUP), line A0 A1 A2.
#include <Servo.h>
Servo servo1;

void motorSet(uint8_t en, uint8_t in1, uint8_t in2, long speed) {
  if (speed > 100L) speed = 100L;
  if (speed < -100L) speed = -100L;
  long magnitude = speed < 0L ? -speed : speed;
  digitalWrite(in1, speed > 0L ? HIGH : LOW);
  digitalWrite(in2, speed < 0L ? HIGH : LOW);
  analogWrite(en, (int)((magnitude * 255L + 50L) / 100L));
}

void setup() {
  Serial.begin(9600);
  servo1.attach(9);
  pinMode(5, OUTPUT); pinMode(7, OUTPUT); pinMode(8, OUTPUT);
  pinMode(6, OUTPUT); pinMode(4, OUTPUT); pinMode(2, OUTPUT);
  pinMode(12, OUTPUT); pinMode(11, INPUT); pinMode(13, OUTPUT); pinMode(3, INPUT_PULLUP);
  servo1.write(45);
  motorSet(5, 7, 8, 50L);
  motorSet(6, 4, 2, 80L);
  tone(10, 1000);
  digitalWrite(13, HIGH);
}

void loop() {
  static uint8_t n = 0;
  if (n < 3) {
    digitalWrite(12, LOW); delayMicroseconds(2);
    digitalWrite(12, HIGH); delayMicroseconds(10); digitalWrite(12, LOW);
    long us = (long)pulseIn(11, HIGH, 30000UL);
    Serial.print(us); Serial.print(' ');
    Serial.print(digitalRead(3)); Serial.print(' ');
    Serial.print(analogRead(A0)); Serial.print(' ');
    Serial.print(analogRead(A1)); Serial.print(' ');
    Serial.println(analogRead(A2));
    n++;
  }
  delay(50);
}
