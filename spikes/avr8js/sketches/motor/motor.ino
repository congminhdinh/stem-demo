// R0.4 sketch 2: motor PWM through an H-bridge (driver hbridge-en-in1-in2), pins of ref-uno-rover@0:
// M1 (left) EN=D5 IN1=D7 IN2=D8, M2 (right) EN=D6 IN1=D4 IN2=D2.
// Contract §4.4: duty = round(|s| * 255 / 100); s > 0 IN1 HIGH IN2 LOW; s < 0 IN1 LOW IN2 HIGH; stop = both IN LOW.
#define M1_EN 5
#define M1_IN1 7
#define M1_IN2 8
#define M2_EN 6
#define M2_IN1 4
#define M2_IN2 2

void motorSet(uint8_t en, uint8_t in1, uint8_t in2, long speed) {
  if (speed > 100L) speed = 100L;
  if (speed < -100L) speed = -100L;
  long magnitude = speed < 0L ? -speed : speed;
  digitalWrite(in1, speed > 0L ? HIGH : LOW);
  digitalWrite(in2, speed < 0L ? HIGH : LOW);
  analogWrite(en, (int)((magnitude * 255L + 50L) / 100L));
}

void setup() {
  pinMode(M1_EN, OUTPUT); pinMode(M1_IN1, OUTPUT); pinMode(M1_IN2, OUTPUT);
  pinMode(M2_EN, OUTPUT); pinMode(M2_IN1, OUTPUT); pinMode(M2_IN2, OUTPUT);
  motorSet(M1_EN, M1_IN1, M1_IN2, 50L);    // phase A: duty 128 on D5 (Timer0, fast PWM)
  motorSet(M2_EN, M2_IN1, M2_IN2, -100L);  // duty 255 on D6: digitalWrite HIGH, no PWM
  delay(100);
  motorSet(M1_EN, M1_IN1, M1_IN2, -30L);   // phase B: duty round(76.5) = 77 on D5
  motorSet(M2_EN, M2_IN1, M2_IN2, 1L);     // duty round(2.55) = 3 on D6
  delay(100);
  motorSet(M1_EN, M1_IN1, M1_IN2, 0L);     // phase C: stop, everything LOW
  motorSet(M2_EN, M2_IN1, M2_IN2, 0L);
}

void loop() {
}
