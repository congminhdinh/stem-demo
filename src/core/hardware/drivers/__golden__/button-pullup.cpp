// button-pullup on port BTN1 as button1
// libraries: arduino:avr@1.8.8 (LGPL-2.1)
#define BUTTON1_PIN 3
// button.pressed (U-30), read
//   setup: pinMode(BUTTON1_PIN, INPUT_PULLUP);
(digitalRead(BUTTON1_PIN) == LOW)
