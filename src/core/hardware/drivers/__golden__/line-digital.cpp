// line-digital on port LN1 as lineLeft
// libraries: arduino:avr@1.8.8 (LGPL-2.1)
#define LINE_LEFT_PIN A0
// line.dark (U-28), read
//   setup: pinMode(LINE_LEFT_PIN, INPUT);
(digitalRead(LINE_LEFT_PIN) == HIGH)
// line.raw (U-29), read
(long)analogRead(LINE_LEFT_PIN)
