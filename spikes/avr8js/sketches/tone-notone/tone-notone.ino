// N18 R1 fix round 1 (not part of run-all.mjs; results.json is unchanged): does PWM on D3/D11 come back after noTone or after a tone that ends by itself, without a new analogWrite?
#define BUZZER 10
void setup() {
  analogWrite(11, 100);    // A (0 ms): PWM alone on OC2A and OC2B
  analogWrite(3, 100);
  delay(100);
  tone(BUZZER, 1000);      // B (100 ms): tone takes Timer2
  delay(100);
  noTone(BUZZER);          // C (200 ms): tone stops, no new analogWrite
  delay(100);
  analogWrite(11, 100);    // D (300 ms): PWM requested again
  analogWrite(3, 100);
  delay(100);
  tone(BUZZER, 1000, 30);  // E (400 ms): a tone that ends by itself at about 430 ms; no new analogWrite
  delay(100);
  analogWrite(11, 100);    // F (500 ms): PWM requested again
  analogWrite(3, 100);
}
void loop() {}
