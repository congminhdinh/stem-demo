// R0.4 sketch 4b: analogWrite(11, ...) and analogWrite(3, ...) on Timer2 around tone(10, 1000) (buzzer D10).
#define BUZZER 10

void setup() {
  analogWrite(11, 100);   // phase A (0 ms): PWM alone on OC2A, Timer2 as init() set it
  analogWrite(3, 100);    //   and on OC2B
  delay(100);
  tone(BUZZER, 1000);     // phase B (100 ms): tone takes Timer2 (CTC, OCR2A = TOP, toggle in ISR)
  delay(100);
  analogWrite(11, 100);   // phase C (200 ms): PWM on OC2A requested while tone holds Timer2
  delay(100);
  analogWrite(3, 100);    // phase D (300 ms): PWM on OC2B requested while tone holds Timer2
  delay(100);
  noTone(BUZZER);         // phase E (400 ms): tone lets Timer2 go
  analogWrite(11, 100);   //   and PWM is requested again on both pins
  analogWrite(3, 100);
  delay(100);
  tone(BUZZER, 1000, 50); // phase F (500 ms): a tone with a duration of 50 ms
  delay(100);
}

void loop() {
}
