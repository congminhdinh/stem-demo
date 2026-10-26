// tcs34725-wire on port CS1 as color1
// libraries: arduino:avr@1.8.8 (LGPL-2.1), Wire@1.0 (LGPL-2.1)
#include <Wire.h>
#define COLOR1_SDA A4
#define COLOR1_SCL A5
uint16_t colorC = 0;
uint16_t colorR = 0;
uint16_t colorG = 0;
uint16_t colorB = 0;
#define COLOR_ADDR 0x29
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
void colorWrite(uint8_t reg, uint8_t value) {
  Wire.beginTransmission(COLOR_ADDR);
  Wire.write((uint8_t)(0x80 | reg));
  Wire.write(value);
  Wire.endTransmission();
}
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
long colorRaw(uint8_t k) {
  colorFetch();
  if (k == 0) return (long)colorR;
  if (k == 1) return (long)colorG;
  if (k == 2) return (long)colorB;
  return (long)colorC;
}
// color.is (U-38), read
//   setup: colorBegin();
colorIs(0L)
// color.raw (U-39), read
colorRaw(3L)
