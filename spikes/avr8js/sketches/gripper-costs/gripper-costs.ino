// N19 G0.2 cost sketch (EMU-20): how long each call of the gripper car's helpers takes, from emulated cycle counts, run by
// spikes/avr8js/run-gripper.ts with the TS TCS34725 on the bus (white light) and again with no device at 0x29 (NACK).
// Same method as costs.ino (N18 R0.4, EMU-08): D8 (PB0) is the marker, set before the call and cleared after it by direct port
// writes; each group prints its name and waits for it to leave, so no Serial interrupt runs while measuring; the harness takes the
// shortest of N samples (the one no interrupt landed in) minus the empty baseline. Arguments are volatile, so LTO cannot fold them.
// The helpers between the markers are the text of gripper-forms.ino.
#include <Servo.h>
#include <Wire.h>

#define GRIPPER_CLAW_PIN 9
#define GRIPPER_LIFT_PIN 10
#define IR_CLAW_PIN A3
#define COLOR_ADDR 0x29

#define MARK_ON() (PORTB |= _BV(PB0))
#define MARK_OFF() (PORTB &= ~_BV(PB0))
#define N 8

Servo gripperClaw;
Servo gripperLift;
uint16_t colorC = 0;
uint16_t colorR = 0;
uint16_t colorG = 0;
uint16_t colorB = 0;

// GRIPPER HELPERS begin (the generated forms; gripper-costs.ino carries the same text, the runner checks it)
void gripperSet(Servo &servo, long angle) {
  if (angle < 0L) angle = 0L;
  if (angle > 90L) angle = 90L;
  servo.write((int)angle);
}

// COLOR_RULES begin (colorRulesCpp() of spikes/avr8js/color-rules.ts; the runner checks this copy)
#define COLOR_RULE_COUNT 7
const uint16_t COLOR_RULES[COLOR_RULE_COUNT][9] PROGMEM = {
  {6, 0, 299, 0, 1000, 0, 1000, 0, 1000},
  {0, 0, 65535, 500, 1000, 0, 299, 0, 1000},
  {1, 0, 65535, 0, 329, 420, 1000, 0, 1000},
  {2, 0, 65535, 0, 299, 0, 1000, 420, 1000},
  {4, 12000, 65535, 0, 419, 0, 1000, 230, 1000},
  {3, 0, 65535, 380, 1000, 330, 1000, 0, 229},
  {5, 0, 3999, 0, 1000, 0, 1000, 0, 1000},
};
// COLOR_RULES end

// One register write: the command byte (CMD bit, repeated-byte protocol, the register) and the value.
void colorWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(COLOR_ADDR);
  Wire.write((uint8_t)(0x80 | reg));
  Wire.write(value);
  Wire.endTransmission();
}

// ATIME 0xEB (21 cycles, 50.4 ms), gain 4x, power on, 3 ms (> 2.4 ms) later the RGBC, then 54 ms for the first window
// (2.4 ms RGBC Init + 50.4 ms). The 3 ms timeout resets the TWI if the bus hangs, so a missing sensor never blocks the program.
void colorBegin() {
  Wire.begin();
  Wire.setWireTimeout(3000, true);
  colorWrite(0x01, 0xEB);
  colorWrite(0x0F, 0x01);
  colorWrite(0x00, 0x01);
  delay(3);
  colorWrite(0x00, 0x03);
  delay(54);
}

// C, R, G, B in one auto-increment read from CDATAL (command 0xB4), little-endian. A NACK or a short read gives zeros.
void colorFetch() {
  Wire.beginTransmission(COLOR_ADDR);
  Wire.write((uint8_t)0xB4);
  if (Wire.endTransmission() != 0 || Wire.requestFrom((uint8_t)COLOR_ADDR, (uint8_t)8) != 8) {
    colorC = 0;
    colorR = 0;
    colorG = 0;
    colorB = 0;
    return;
  }
  uint8_t bytes[8];
  for (uint8_t i = 0; i < 8; i++) {
    bytes[i] = (uint8_t)Wire.read();
  }
  colorC = (uint16_t)bytes[0] | ((uint16_t)bytes[1] << 8);
  colorR = (uint16_t)bytes[2] | ((uint16_t)bytes[3] << 8);
  colorG = (uint16_t)bytes[4] | ((uint16_t)bytes[5] << 8);
  colorB = (uint16_t)bytes[6] | ((uint16_t)bytes[7] << 8);
}

// The first rule whose C and per-mille (of r + g + b, truncated) are inside its bounds; 6 (unknown) when none is.
uint8_t colorClassify() {
  unsigned long sum = (unsigned long)colorR + colorG + colorB;
  uint16_t r = sum == 0UL ? 0 : (uint16_t)((colorR * 1000UL) / sum);
  uint16_t g = sum == 0UL ? 0 : (uint16_t)((colorG * 1000UL) / sum);
  uint16_t b = sum == 0UL ? 0 : (uint16_t)((colorB * 1000UL) / sum);
  for (uint8_t i = 0; i < COLOR_RULE_COUNT; i++) {
    const uint16_t *rule = COLOR_RULES[i];
    if (colorC >= pgm_read_word(&rule[1]) && colorC <= pgm_read_word(&rule[2]) &&
        r >= pgm_read_word(&rule[3]) && r <= pgm_read_word(&rule[4]) &&
        g >= pgm_read_word(&rule[5]) && g <= pgm_read_word(&rule[6]) &&
        b >= pgm_read_word(&rule[7]) && b <= pgm_read_word(&rule[8])) {
      return (uint8_t)pgm_read_word(&rule[0]);
    }
  }
  return 6;
}

bool colorIs(uint8_t n) {
  colorFetch();
  return colorClassify() == n;
}

// 0 red, 1 green, 2 blue, 3 clear.
long colorRaw(uint8_t k) {
  colorFetch();
  if (k == 0) return (long)colorR;
  if (k == 1) return (long)colorG;
  if (k == 2) return (long)colorB;
  return (long)colorC;
}
// GRIPPER HELPERS end

// Spike only: colorBegin's statements without its two delays (a cross-check of colorBegin minus delay(3) and delay(54)).
void colorBeginNoDelays() {
  Wire.begin();
  Wire.setWireTimeout(3000, true);
  colorWrite(0x01, 0xEB);
  colorWrite(0x0F, 0x01);
  colorWrite(0x00, 0x01);
  colorWrite(0x00, 0x03);
}

volatile long vAngle = 45L;
volatile long vOver = 120L;
volatile long vUnder = -5L;
volatile uint8_t vColour = 4;
volatile uint8_t vChannel = 3;
volatile unsigned long vMs3 = 3UL;
volatile unsigned long vMs54 = 54UL;
volatile uint16_t vC;
volatile uint16_t vR;
volatile uint16_t vG;
volatile uint16_t vB;
volatile uint8_t sink8;
volatile long sink32;

void group(const __FlashStringHelper *name) {
  Serial.print(F("\n#G "));
  Serial.println(name);
  Serial.flush();
  delay(3);
}

#define MEASURE_N(name, count, statement)        \
  do {                                           \
    group(F(name));                              \
    for (uint8_t i = 0; i < (count); i++) {      \
      MARK_ON();                                 \
      statement;                                 \
      MARK_OFF();                                \
      delayMicroseconds(300);                    \
    }                                            \
  } while (0)

#define MEASURE(name, statement) MEASURE_N(name, N, statement)

// colorClassify on a reading (the model's counts of each light, plan placeholder), then print the class it gave.
#define CLASSIFY(name, c, r, g, b)               \
  do {                                           \
    vC = c;                                      \
    vR = r;                                      \
    vG = g;                                      \
    vB = b;                                      \
    group(F(name));                              \
    for (uint8_t i = 0; i < N; i++) {            \
      colorC = vC;                               \
      colorR = vR;                               \
      colorG = vG;                               \
      colorB = vB;                               \
      MARK_ON();                                 \
      sink8 = colorClassify();                   \
      MARK_OFF();                                \
      delayMicroseconds(300);                    \
    }                                            \
    Serial.println(sink8);                       \
    Serial.flush();                              \
  } while (0)

void setup() {
  Serial.begin(9600);
  DDRB |= _BV(PB0);
  pinMode(IR_CLAW_PIN, INPUT);

  MEASURE("baseline", (void)0);
  pinMode(4, INPUT);
  MEASURE("digitalRead A3", sink8 = digitalRead(IR_CLAW_PIN));
  MEASURE("digitalRead A1 (as EMU-08)", sink8 = digitalRead(A1));
  MEASURE("digitalRead D4 (as EMU-08)", sink8 = digitalRead(4));
  MEASURE("ir detect A3 (digitalRead == LOW)", sink8 = (digitalRead(IR_CLAW_PIN) == LOW));

  gripperClaw.attach(GRIPPER_CLAW_PIN);
  gripperClaw.write(0);
  gripperLift.attach(GRIPPER_LIFT_PIN);
  gripperLift.write(90);
  MEASURE("Servo.write claw v=45", gripperClaw.write((int)vAngle));
  MEASURE("Servo.write claw v=120", gripperClaw.write((int)vOver));
  MEASURE("gripperSet claw v=45", gripperSet(gripperClaw, vAngle));
  MEASURE("gripperSet lift v=45", gripperSet(gripperLift, vAngle));
  MEASURE("gripperSet claw v=120 (clamped to 90)", gripperSet(gripperClaw, vOver));
  MEASURE("gripperSet lift v=-5 (clamped to 0)", gripperSet(gripperLift, vUnder));

  MEASURE_N("colorBegin", 4, colorBegin());
  MEASURE("colorBegin without its delays", colorBeginNoDelays());
  MEASURE("delay v=3", delay(vMs3));
  MEASURE("delay v=54", delay(vMs54));
  MEASURE("colorWrite", colorWrite(0x0F, 0x01));
  MEASURE_N("colorFetch, servos attached", 32, colorFetch());
  // The rest with no Servo interrupt: a call over 1 ms always has Timer0's in it, so 32 samples find one where it fell in bus time.
  gripperClaw.detach();
  gripperLift.detach();
  MEASURE_N("colorFetch, servos detached", 32, colorFetch());
  MEASURE_N("colorIs v=4", 32, sink8 = colorIs(vColour));
  MEASURE_N("colorRaw v=3", 32, sink32 = colorRaw(vChannel));

  CLASSIFY("colorClassify red", 11100, 8047, 1675, 1377);
  CLASSIFY("colorClassify green", 8892, 2165, 4979, 1747);
  CLASSIFY("colorClassify blue", 11150, 988, 4144, 6017);
  CLASSIFY("colorClassify yellow", 17605, 9565, 6719, 1320);
  CLASSIFY("colorClassify white", 21504, 9717, 8910, 7297);
  CLASSIFY("colorClassify black", 3460, 1292, 1188, 979);
  CLASSIFY("colorClassify none", 120, 40, 40, 40);
  CLASSIFY("colorClassify zeros (NACK)", 0, 0, 0, 0);
  CLASSIFY("colorClassify grey (no rule)", 8000, 2667, 2667, 2666);
  group(F("loop"));
}

void loop() {
}
