// buzzer-tone on port BZ1 as buzzer
// libraries: arduino:avr@1.8.8 (LGPL-2.1)
#define BUZZER_PIN 10
void buzzerTone(uint8_t pin, long hz, long ms) {
  if (hz < 31L) hz = 31L;
  if (hz > 4000L) hz = 4000L;
  if (ms < 1L) ms = 1L;
  if (ms > 60000L) ms = 60000L;
  tone(pin, (unsigned int)hz, (unsigned long)ms);
}
// buzzer.tone (U-25), call
buzzerTone(BUZZER_PIN, 440L, 100L);
// buzzer.stop (U-26), call
noTone(BUZZER_PIN);
