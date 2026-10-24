// led-digital on port LED1 as led1
// libraries: arduino:avr@1.8.8 (LGPL-2.1)
#define LED1_PIN 13
// led.set (U-24), call
//   setup: pinMode(LED1_PIN, OUTPUT);
digitalWrite(LED1_PIN, (true) ? HIGH : LOW);
