// N19 G0.2: the C++ forms of the gripper car (plan §4.3, D-G7), run on avr8js against the TS TCS34725 model by
// spikes/avr8js/run-gripper-forms.ts. What the generator is to write for ref-uno-gripper@0: Servo.h for the claw (D9) and the
// lift (D10), both clamped to 0..90 by gripperSet; the IR between the jaws on A3 (LOW = an object); the TCS34725 at 0x29 over raw
// Wire (arduino:avr 1.8.8's Wire 1.0, no Adafruit library), classified by the integer COLOR_RULES table.
// Each section prints "#S <name>" and what it read; the harness scripts the inputs in µs from the start of setup() and checks the
// lines, the servo pulses and every TWI transaction against the TS side. The times below are millis() (from Timer0's start).
#include <Servo.h>
#include <Wire.h>

#define GRIPPER_CLAW_PIN 9
#define GRIPPER_LIFT_PIN 10
#define IR_CLAW_PIN A3
#define COLOR_ADDR 0x29

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

// Spike diagnostic, not a generated form: one register read (repeated-byte command); 0 on a NACK.
uint8_t colorRead8(uint8_t reg) {
  Wire.beginTransmission(COLOR_ADDR);
  Wire.write((uint8_t)(0x80 | reg));
  if (Wire.endTransmission() != 0 || Wire.requestFrom((uint8_t)COLOR_ADDR, (uint8_t)1) != 1) {
    return 0;
  }
  return (uint8_t)Wire.read();
}

void section(const __FlashStringHelper *name) {
  Serial.print(F("#S "));
  Serial.println(name);
}

void waitUntil(unsigned long ms) {
  while (millis() < ms) {
  }
}

void setup() {
  Serial.begin(9600);
  gripperClaw.attach(GRIPPER_CLAW_PIN);
  gripperClaw.write(0);
  gripperLift.attach(GRIPPER_LIFT_PIN);
  gripperLift.write(90);
  pinMode(IR_CLAW_PIN, INPUT);
  colorBegin();

  section(F("id"));
  Serial.println(colorRead8(0x12));
  Serial.println(colorRead8(0x13));
  Serial.println(colorRead8(0x01));
  Serial.println(colorRead8(0x0F));

  // Claw: 0 → 80 → 120 (90) → 0. Lift: 90 → 0 → -10 (0) → 45.
  section(F("grip"));
  waitUntil(200);
  gripperSet(gripperClaw, 80L);
  waitUntil(320);
  gripperSet(gripperLift, 0L);
  waitUntil(440);
  gripperSet(gripperClaw, 120L);
  waitUntil(560);
  gripperSet(gripperLift, -10L);
  waitUntil(680);
  gripperSet(gripperLift, 45L);
  waitUntil(800);
  gripperSet(gripperClaw, 0L);

  // The harness drives A3 HIGH (nothing between the jaws), then LOW from 1050 ms.
  section(F("ir"));
  waitUntil(1000);
  Serial.println(digitalRead(IR_CLAW_PIN) == LOW);
  waitUntil(1100);
  Serial.println(digitalRead(IR_CLAW_PIN) == LOW);

  // Seven lights of 250 ms each from 1500 ms (red, green, blue, yellow, white, black, none), read 150 ms into each: by then
  // a whole window (2.4 ms Init + 50.4 ms) has run in that light. Per light: C R G B, then colorIs(0..6).
  section(F("color"));
  for (uint8_t k = 0; k < 7; k++) {
    waitUntil(1500UL + 250UL * k + 150UL);
    Serial.print(colorRaw(3));
    Serial.print(' ');
    Serial.print(colorRaw(0));
    Serial.print(' ');
    Serial.print(colorRaw(1));
    Serial.print(' ');
    Serial.println(colorRaw(2));
    for (uint8_t n = 0; n < 7; n++) {
      Serial.print(colorIs(n));
    }
    Serial.println();
  }

  section(F("end"));
  Serial.println(Wire.getWireTimeoutFlag());
}

void loop() {
}
