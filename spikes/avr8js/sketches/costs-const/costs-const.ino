// R0.4 cost sketch, variant: the same calls with constant arguments only, in a small program.
// avr-gcc -flto may inline or fold a call here that it keeps as a call in costs.ino: the difference is the
// spread of a cost between two programs (ADR 0003). Same marker and method as costs.ino.
#include <Servo.h>

#define MARK_ON() (PORTB |= _BV(PB0))
#define MARK_OFF() (PORTB &= ~_BV(PB0))
#define N 8

Servo servo1;

void group(const __FlashStringHelper *name) {
  Serial.print(F("\n#G "));
  Serial.println(name);
  Serial.flush();
  delay(3);
}

#define MEASURE(name, statement)                 \
  do {                                           \
    group(F(name));                              \
    for (uint8_t i = 0; i < N; i++) {            \
      MARK_ON();                                 \
      statement;                                 \
      MARK_OFF();                                \
      delayMicroseconds(300);                    \
    }                                            \
  } while (0)

void setup() {
  Serial.begin(9600);
  DDRB |= _BV(PB0);
  pinMode(7, OUTPUT);
  MEASURE("baseline", (void)0);
  MEASURE("digitalWrite D7 HIGH (no timer)", digitalWrite(7, HIGH));
  MEASURE("analogWrite D5 128 (Timer0)", analogWrite(5, 128));
  servo1.attach(9);
  MEASURE("Servo.write 90", servo1.write(90));
  servo1.detach();
  MEASURE("tone D10 1000 Hz", tone(10, 1000));
  noTone(10);
  group(F("loop"));
}

void loop() {
}
