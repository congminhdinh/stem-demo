// N18 C2 cost sketch (evidence for the parity harness's allowed differences): what a driver helper costs beyond the Arduino calls
// the simulator charges, and what tone() costs at each frequency (costsUs.tone was measured at 1000 Hz only).
// Same method as costs.ino: D8 (PB0) marks the call (so no measured call may touch D8) by direct port writes; the shortest of N samples minus the empty baseline.
#define MARK_ON() (PORTB |= _BV(PB0))
#define MARK_OFF() (PORTB &= ~_BV(PB0))
#define N 8

volatile long vSpeed = 50L;
volatile long vSpeedMinus = -100L;
volatile int vDuty = 128;
volatile unsigned long vMs = 100UL;
volatile unsigned int vHz = 1000;

void motorSet(uint8_t en, uint8_t in1, uint8_t in2, long speed) {
  if (speed > 100L) speed = 100L;
  if (speed < -100L) speed = -100L;
  long magnitude = speed < 0L ? -speed : speed;
  digitalWrite(in1, speed > 0L ? HIGH : LOW);
  digitalWrite(in2, speed < 0L ? HIGH : LOW);
  analogWrite(en, (int)((magnitude * 255L + 50L) / 100L));
}

void group(const __FlashStringHelper *name) {
  Serial.print(F("\n#G "));
  Serial.println(name);
  Serial.flush();
  delay(3);
}

#define MEASURE(name, before, statement)         \
  do {                                           \
    group(F(name));                              \
    for (uint8_t i = 0; i < N; i++) {            \
      before;                                    \
      MARK_ON();                                 \
      statement;                                 \
      MARK_OFF();                                \
      delayMicroseconds(300);                    \
    }                                            \
  } while (0)

#define TONE_AT(hz) MEASURE("tone D10 fresh " #hz " Hz", (noTone(10), vHz = hz), tone(10, vHz, vMs))

void setup() {
  Serial.begin(9600);
  DDRB |= _BV(PB0);
  pinMode(5, OUTPUT);
  pinMode(7, OUTPUT);
  pinMode(4, OUTPUT);

  MEASURE("baseline", (void)0, (void)0);
  MEASURE("digitalWrite D7 HIGH", (void)0, digitalWrite(7, HIGH));
  MEASURE("digitalWrite D4 LOW", (void)0, digitalWrite(4, LOW));
  MEASURE("analogWrite D5 v=128", (void)0, analogWrite(5, vDuty));
  MEASURE("motorSet v=50", (void)0, motorSet(5, 7, 4, vSpeed));
  MEASURE("motorSet v=-100", (void)0, motorSet(5, 7, 4, vSpeedMinus));
  TONE_AT(31);
  TONE_AT(100);
  TONE_AT(200);
  TONE_AT(440);
  TONE_AT(500);
  TONE_AT(1000);
  TONE_AT(1500);
  TONE_AT(3000);
  TONE_AT(4000);
  MEASURE("tone D10 replacing 1000 by 1500 Hz", (noTone(10), tone(10, 1000, 100UL), vHz = 1500), tone(10, vHz, vMs));
  noTone(10);
  group(F("loop"));
}

void loop() {
}
