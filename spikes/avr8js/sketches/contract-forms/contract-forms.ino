// R0.4 / R0.3: every C++ form of docs/uno-compatibility-contract.md, written the way C1 will write a sketch:
// header comment, #include, #define pins of the kit, globals, helpers, setup(), loop(). Kit: ref-uno-rover@0.
// The helper texts between "contract helper" lines are copied verbatim into src/core/compat/uno-contract.ts
// (a test checks that they are the same). A4 (PC4) is a marker for timing only; it is not part of any form.
#include <Servo.h>

#define MOTOR_LEFT_EN 5
#define MOTOR_LEFT_IN1 7
#define MOTOR_LEFT_IN2 8
#define MOTOR_RIGHT_EN 6
#define MOTOR_RIGHT_IN1 4
#define MOTOR_RIGHT_IN2 2
#define ULTRASONIC_TRIG 12
#define ULTRASONIC_ECHO 11
#define LINE_LEFT A0
#define LINE_CENTER A1
#define LINE_RIGHT A2
#define SERVO1_PIN 9
#define LED1_PIN 13
#define BUZZER_PIN 10
#define BUTTON1_PIN 3

Servo servo1;

long x = 0L;
long count = 0L;
long total = 0L;

#define MARK_ON() (PORTC |= _BV(PC4))
#define MARK_OFF() (PORTC &= ~_BV(PC4))

// --- contract helper: int32 ---
long add32(long a, long b) { return (long)((unsigned long)a + (unsigned long)b); }
long sub32(long a, long b) { return (long)((unsigned long)a - (unsigned long)b); }
long mul32(long a, long b) { return (long)((unsigned long)a * (unsigned long)b); }
long neg32(long a) { return (long)(0UL - (unsigned long)a); }
long div32(long a, long b) { return b == -1L ? neg32(a) : (b == 0L ? 0L : a / b); }
long mod32(long a, long b) { return (b == -1L || b == 0L) ? 0L : a % b; }
// --- end contract helper ---

// --- contract helper: hbridge-en-in1-in2 ---
void motorSet(uint8_t en, uint8_t in1, uint8_t in2, long speed) {
  if (speed > 100L) speed = 100L;
  if (speed < -100L) speed = -100L;
  long magnitude = speed < 0L ? -speed : speed;
  digitalWrite(in1, speed > 0L ? HIGH : LOW);
  digitalWrite(in2, speed < 0L ? HIGH : LOW);
  analogWrite(en, (int)((magnitude * 255L + 50L) / 100L));
}
// --- end contract helper ---

// --- contract helper: servo-lib ---
void servoSet(Servo &servo, long angle) {
  if (angle < 0L) angle = 0L;
  if (angle > 180L) angle = 180L;
  servo.write((int)angle);
}
// --- end contract helper ---

// --- contract helper: buzzer-tone ---
void buzzerTone(uint8_t pin, long hz, long ms) {
  if (hz < 31L) hz = 31L;
  if (hz > 4000L) hz = 4000L;
  if (ms < 1L) ms = 1L;
  if (ms > 60000L) ms = 60000L;
  tone(pin, (unsigned int)hz, (unsigned long)ms);
}
// --- end contract helper ---

// --- contract helper: hcsr04-pulsein ---
long ultrasonicCm(uint8_t trig, uint8_t echo) {
  digitalWrite(trig, LOW);
  delayMicroseconds(2);
  digitalWrite(trig, HIGH);
  delayMicroseconds(10);
  digitalWrite(trig, LOW);
  long us = (long)pulseIn(echo, HIGH, 30000UL);
  if (us == 0L) return 400L;
  long cm = us / 58L;
  if (cm < 2L) return 2L;
  if (cm > 400L) return 400L;
  return cm;
}
// --- end contract helper ---

// --- contract helper: pwm-write ---
void pwmWrite(uint8_t pin, long value) {
  if (value < 0L) value = 0L;
  if (value > 255L) value = 255L;
  analogWrite(pin, (int)value);
}
// --- end contract helper ---

long sideEffect(long value) {
  Serial.print(F("eval="));
  Serial.println(value);
  return value;
}

void section(const __FlashStringHelper *name) {
  Serial.print(F("#S "));
  Serial.println(name);
  Serial.flush();
}

void setup() {
  Serial.begin(9600);
  pinMode(MOTOR_LEFT_EN, OUTPUT);
  pinMode(MOTOR_LEFT_IN1, OUTPUT);
  pinMode(MOTOR_LEFT_IN2, OUTPUT);
  pinMode(MOTOR_RIGHT_EN, OUTPUT);
  pinMode(MOTOR_RIGHT_IN1, OUTPUT);
  pinMode(MOTOR_RIGHT_IN2, OUTPUT);
  pinMode(ULTRASONIC_TRIG, OUTPUT);
  pinMode(ULTRASONIC_ECHO, INPUT);
  pinMode(LINE_LEFT, INPUT);
  pinMode(LINE_CENTER, INPUT);
  pinMode(LINE_RIGHT, INPUT);
  pinMode(LED1_PIN, OUTPUT);
  pinMode(BUTTON1_PIN, INPUT_PULLUP);
  servo1.attach(SERVO1_PIN);
  servo1.write(90);
  DDRC |= _BV(PC4);

  section(F("arith"));
  Serial.println(add32(2147483647L, 1L));
  Serial.println(sub32((-2147483647L - 1L), 1L));
  Serial.println(mul32(300L, 200L));
  Serial.println(mul32(65536L, 65536L));
  Serial.println(div32(-7L, 2L));
  Serial.println(mod32(-7L, 2L));
  Serial.println(div32((-2147483647L - 1L), -1L));
  Serial.println(mod32((-2147483647L - 1L), -1L));
  Serial.println(div32(7L, 0L));
  Serial.println(mod32(7L, 0L));
  Serial.println(neg32((-2147483647L - 1L)));

  section(F("bool"));
  Serial.println((3L > 2L));
  Serial.println(((3L > 2L) && (2L > 3L)));
  Serial.println(!((3L > 2L)));

  section(F("repeat"));
  count = 0L;
  {
    const long _n = (sideEffect(3L));
    for (long _r = 0L; _r < _n; _r += 1L) {
      count = add32(count, 1L);
    }
  }
  Serial.println(count);
  {
    const long _n = (-2L);
    for (long _r = 0L; _r < _n; _r += 1L) {
      count = add32(count, 1L);
    }
  }
  Serial.println(count);

  section(F("countup"));
  x = 99L;
  total = 0L;
  {
    const long _from = (sideEffect(1L));
    const long _to = (sideEffect(4L));
    for (long _c = _from; _c <= _to; _c += 1L) {
      x = _c;
      total = add32(total, x);
    }
  }
  Serial.println(x);
  Serial.println(total);

  section(F("print"));
  Serial.println(F("Xin chào"));
  Serial.println(F("say \"hi\" \\ ok"));
  Serial.print(F("x = "));
  Serial.println(x);
  Serial.println((-2147483647L - 1L));

  section(F("millis"));
  Serial.println((long)millis());

  section(F("control"));
  x = 2L;
  if ((x == 1L)) {
    Serial.println(F("one"));
  } else if ((x == 2L)) {
    Serial.println(F("two"));
  } else {
    Serial.println(F("other"));
  }
  count = 0L;
  while ((count < 3L)) {
    count = add32(count, 1L);
  }
  Serial.println(count);

  section(F("motor"));
  motorSet(MOTOR_LEFT_EN, MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, 50L);
  motorSet(MOTOR_RIGHT_EN, MOTOR_RIGHT_IN1, MOTOR_RIGHT_IN2, -100L);
  delay(30);
  {
    const long _s = (60L);
    motorSet(MOTOR_LEFT_EN, MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, _s);
    motorSet(MOTOR_RIGHT_EN, MOTOR_RIGHT_IN1, MOTOR_RIGHT_IN2, _s);
  }
  delay(30);
  {
    const long _s = (40L);
    motorSet(MOTOR_LEFT_EN, MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, neg32(_s));
    motorSet(MOTOR_RIGHT_EN, MOTOR_RIGHT_IN1, MOTOR_RIGHT_IN2, _s);
  }
  delay(30);
  motorSet(MOTOR_LEFT_EN, MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, 150L);
  delay(30);
  motorSet(MOTOR_LEFT_EN, MOTOR_LEFT_IN1, MOTOR_LEFT_IN2, 0L);
  motorSet(MOTOR_RIGHT_EN, MOTOR_RIGHT_IN1, MOTOR_RIGHT_IN2, 0L);
  delay(30);

  section(F("servo"));
  delay(45);
  servoSet(servo1, 0L);
  delay(45);
  servoSet(servo1, 180L);
  delay(45);
  servoSet(servo1, 600L);
  delay(45);
  servoSet(servo1, -5L);
  delay(45);

  section(F("led"));
  digitalWrite(LED1_PIN, ((1L > 0L)) ? HIGH : LOW);
  delay(5);
  digitalWrite(LED1_PIN, ((0L > 1L)) ? HIGH : LOW);
  delay(5);

  section(F("buzzer"));
  buzzerTone(BUZZER_PIN, 440L, 100L);
  delay(50);
  buzzerTone(BUZZER_PIN, 880L, 30L);
  delay(60);
  buzzerTone(BUZZER_PIN, 10L, 40L);
  delay(60);
  buzzerTone(BUZZER_PIN, 9000L, 20L);
  delay(40);
  buzzerTone(BUZZER_PIN, 1000L, 0L);
  delay(20);
  buzzerTone(BUZZER_PIN, 1000L, 1000L);
  delay(20);
  noTone(BUZZER_PIN);
  delay(20);

  section(F("ultrasonic"));
  MARK_ON();
  long d1 = ultrasonicCm(ULTRASONIC_TRIG, ULTRASONIC_ECHO);
  MARK_OFF();
  Serial.println(d1);
  delay(5);
  MARK_ON();
  long d2 = ultrasonicCm(ULTRASONIC_TRIG, ULTRASONIC_ECHO);
  MARK_OFF();
  Serial.println(d2);

  section(F("line"));
  Serial.println((digitalRead(LINE_LEFT) == HIGH));
  Serial.println((digitalRead(LINE_CENTER) == LOW));
  Serial.println((long)analogRead(LINE_RIGHT));

  section(F("button"));
  Serial.println((digitalRead(BUTTON1_PIN) == LOW));
  delay(5);
  Serial.println((digitalRead(BUTTON1_PIN) == LOW));

  section(F("raw"));
  pinMode(A3, OUTPUT);
  digitalWrite(A3, ((1L)) ? HIGH : LOW);
  delay(2);
  pwmWrite(A3, 100L);
  delay(2);
  pwmWrite(A3, 300L);
  delay(2);
  pwmWrite(A3, -4L);
  delay(2);
  Serial.println((digitalRead(BUTTON1_PIN) == HIGH));
  Serial.println((long)analogRead(LINE_RIGHT));

  section(F("loop"));
}

void loop() {
}
