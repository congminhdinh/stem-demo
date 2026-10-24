// R0.4 sketch 4a: analogWrite(10, 200) on Timer1 before and while Servo.attach(9) holds Timer1.
// Phases are 100 ms apart; the harness reads them from the trace.
#include <Servo.h>
Servo servo1;

void setup() {
  analogWrite(10, 200);   // phase A (0 ms): PWM alone, Timer1 as init() set it (8-bit phase-correct, /64)
  delay(100);
  servo1.attach(9);       // phase B (100 ms): Servo takes Timer1 (normal mode, /8, OCR1A interrupt)
  servo1.write(90);
  delay(100);
  analogWrite(10, 200);   // phase C (200 ms): PWM requested while Servo holds Timer1
  delay(100);
  servo1.detach();        // phase D (300 ms): Servo lets Timer1 go
  analogWrite(10, 200);   //   and PWM is requested again
  delay(100);
  analogWrite(9, 100);    // phase E (400 ms): PWM on the servo's own pin after detach
  delay(100);
}

void loop() {
}
