// R0.4 extra sketch: analogWrite on the six PWM pins at once, and on pins without PWM (the 128 threshold).
void setup() {
  analogWrite(3, 64);    // Timer2 B
  analogWrite(5, 64);    // Timer0 B
  analogWrite(6, 191);   // Timer0 A
  analogWrite(9, 64);    // Timer1 A
  analogWrite(10, 191);  // Timer1 B
  analogWrite(11, 128);  // Timer2 A
  analogWrite(7, 127);   // no PWM: below 128 -> LOW
  analogWrite(8, 128);   // no PWM: 128 and above -> HIGH
  analogWrite(A0, 200);  // an analog pin used as a digital output
  analogWrite(A1, 0);
}

void loop() {
}
