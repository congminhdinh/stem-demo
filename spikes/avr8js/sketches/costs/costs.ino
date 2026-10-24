// R0.4 cost sketch: how long each Arduino call takes, from emulated cycle counts.
// D8 (PB0) is the marker: set before the call, cleared after it, by direct port writes (sbi/cbi, 2 cycles each).
// Each group prints its name on Serial and waits for it to leave (flush), so no Serial interrupt runs while measuring.
// The harness takes the shortest of N samples (the one no Timer0 interrupt landed in) minus the empty baseline.
#include <Servo.h>

#define MARK_ON() (PORTB |= _BV(PB0))
#define MARK_OFF() (PORTB &= ~_BV(PB0))
#define N 8

volatile uint8_t sink8;
volatile int sink16;
volatile unsigned long sink32;
// Values the generated code computes at run time: volatile, so LTO cannot fold the call.
volatile int vDuty = 128;
volatile int vAngle = 90;
volatile unsigned int vHz = 1000;
volatile long vNumber1 = 7L;
volatile long vNumber5 = 12345L;
volatile long vNumber10 = 1234567890L;
volatile long vNumberMin = -2147483647L - 1L;
volatile unsigned long vMs = 1UL;
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

// Serial calls: wait for the line to drain between samples, outside the marks.
#define MEASURE_SERIAL(name, statement)          \
  do {                                           \
    group(F(name));                              \
    for (uint8_t i = 0; i < N; i++) {            \
      MARK_ON();                                 \
      statement;                                 \
      MARK_OFF();                                \
      Serial.flush();                            \
      delay(2);                                  \
    }                                            \
  } while (0)

#define MEASURE_ONCE(name, statement)            \
  do {                                           \
    group(F(name));                              \
    MARK_ON();                                   \
    statement;                                   \
    MARK_OFF();                                  \
    Serial.flush();                              \
    delay(2);                                    \
  } while (0)

void setup() {
  Serial.begin(9600);
  DDRB |= _BV(PB0);
  pinMode(7, OUTPUT);
  pinMode(5, OUTPUT);
  pinMode(13, OUTPUT);
  pinMode(4, INPUT);
  pinMode(11, INPUT);

  MEASURE("baseline", (void)0);
  MEASURE("digitalWrite D7 HIGH (no timer)", digitalWrite(7, HIGH));
  MEASURE("digitalWrite D7 LOW (no timer)", digitalWrite(7, LOW));
  MEASURE("digitalWrite D13 HIGH (no timer)", digitalWrite(13, HIGH));
  MEASURE("digitalWrite D5 LOW (Timer0 pin)", digitalWrite(5, LOW));
  MEASURE("digitalRead D4 (no timer)", sink8 = digitalRead(4));
  MEASURE("digitalRead D11 (Timer2 pin)", sink8 = digitalRead(11));
  MEASURE("digitalRead A1", sink8 = digitalRead(A1));
  MEASURE_ONCE("analogRead A0 first", sink16 = analogRead(A0));
  MEASURE("analogRead A0", sink16 = analogRead(A0));
  MEASURE("analogWrite D5 128 (Timer0)", analogWrite(5, 128));
  MEASURE("analogWrite D9 128 (Timer1)", analogWrite(9, 128));
  MEASURE("analogWrite D3 128 (Timer2)", analogWrite(3, 128));
  MEASURE("analogWrite D5 v=128 (Timer0, run-time value)", analogWrite(5, vDuty));
  MEASURE("analogWrite D6 0", analogWrite(6, 0));
  MEASURE("analogWrite D6 255", analogWrite(6, 255));
  MEASURE("analogWrite D7 200 (no PWM)", analogWrite(7, 200));
  MEASURE("pinMode D7 OUTPUT", pinMode(7, OUTPUT));
  MEASURE("pinMode D4 INPUT_PULLUP", pinMode(4, INPUT_PULLUP));
  MEASURE("millis", sink32 = millis());
  MEASURE("micros", sink32 = micros());
  MEASURE("delayMicroseconds 10", delayMicroseconds(10));
  MEASURE("delay 1", delay(1));
  MEASURE("delay 10", delay(10));
  MEASURE("delay v=1 (run-time value)", delay(vMs));
  MEASURE_ONCE("pulseIn D11 no pulse, timeout 30000, Timer0 only", sink32 = pulseIn(11, HIGH, 30000UL));
  MEASURE_ONCE("pulseIn D11 no pulse, timeout 10000, Timer0 only", sink32 = pulseIn(11, HIGH, 10000UL));
  MEASURE_SERIAL("Serial.write 1 char", Serial.write('x'));
  MEASURE_SERIAL("Serial.print long 12345", Serial.print(12345L));
  MEASURE_SERIAL("Serial.print long v=7", Serial.print(vNumber1));
  MEASURE_SERIAL("Serial.print long v=12345", Serial.print(vNumber5));
  MEASURE_SERIAL("Serial.print long v=1234567890", Serial.print(vNumber10));
  MEASURE_SERIAL("Serial.print long v=-2147483648", Serial.print(vNumberMin));
  MEASURE_SERIAL("Serial.println long v=12345", Serial.println(vNumber5));
  MEASURE_SERIAL("Serial.println no args", Serial.println());
  MEASURE_SERIAL("Serial.println bool true", Serial.println(true));
  MEASURE_SERIAL("Serial.println F 10 chars", Serial.println(F("0123456789")));
  MEASURE_ONCE("Serial.print F 64 chars", Serial.print(F("0123456789012345678901234567890123456789012345678901234567890123")));
  MEASURE_ONCE("Serial.print F 65 chars", Serial.print(F("01234567890123456789012345678901234567890123456789012345678901234")));
  MEASURE_ONCE("Serial.print F 100 chars", Serial.print(F("0123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789")));
  MEASURE_ONCE("Serial.print F 200 chars", Serial.print(F("01234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123456789")));

  // Interrupt load: 100 ms of fixed cycles with interrupts off, then on (Timer0 millis alone).
  MEASURE_ONCE("spin 1600000 cycles, interrupts off", { noInterrupts(); __builtin_avr_delay_cycles(1600000UL); interrupts(); });
  MEASURE_ONCE("spin 1600000 cycles, Timer0 only", __builtin_avr_delay_cycles(1600000UL));
  servo1.attach(9);
  MEASURE("Servo.write 90", servo1.write(90));
  MEASURE("Servo.write v=90 (run-time value)", servo1.write(vAngle));
  MEASURE_ONCE("spin 1600000 cycles, Timer0 + Servo", __builtin_avr_delay_cycles(1600000UL));
  servo1.detach();
  MEASURE("tone D10 1000 Hz", tone(10, 1000));
  MEASURE("tone D10 v=1000 Hz (run-time value)", tone(10, vHz));
  MEASURE("tone D10 v=1000 Hz, 100 ms (run-time value)", tone(10, vHz, 100UL));
  tone(10, vHz);  // the tone above had a 100 ms duration: start one without, for the whole spin
  MEASURE_ONCE("spin 1600000 cycles, Timer0 + tone 1000 Hz", __builtin_avr_delay_cycles(1600000UL));
  MEASURE("noTone D10", noTone(10));
  group(F("loop"));
}

// The loop toggles the marker once per iteration (PINB write: 1 cycle out + 1 cycle ldi), nothing else.
void loop() {
  PINB = _BV(PB0);
}
