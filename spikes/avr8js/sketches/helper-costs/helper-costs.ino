// N18 C2 cost sketch (evidence for the parity harness's allowed differences): what a driver helper costs beyond the Arduino calls
// the simulator charges (motorSet at every speed -100..100: its long division takes a time that depends on the value), what tone() costs at each frequency on a silent pin and on a pin that already plays (costsUs.tone was
// measured at 1000 Hz on a playing pin only), and what Serial.begin(9600) costs.
// Same method as costs.ino: D8 (PB0) marks the call (so no measured call may touch D8) by direct port writes; the shortest of N samples minus the empty baseline.
#define MARK_ON() (PORTB |= _BV(PB0))
#define MARK_OFF() (PORTB &= ~_BV(PB0))
#define N 8

volatile long vSpeed = 50L;
volatile long vSpeedMinus = -100L;
volatile int vDuty = 128;
volatile unsigned long vMs = 100UL;
volatile unsigned int vHz = 1000;

void motorSet(uint8_t en, uint8_t in1, uint8_t in2, long speed) {
  if (speed > 100L) speed = 100L;
  if (speed < -100L) speed = -100L;
  long magnitude = speed < 0L ? -speed : speed;
  digitalWrite(in1, speed > 0L ? HIGH : LOW);
  digitalWrite(in2, speed < 0L ? HIGH : LOW);
  analogWrite(en, (int)((magnitude * 255L + 50L) / 100L));
}

void group(const __FlashStringHelper *name) {
  Serial.print(F("\n#G "));
  Serial.println(name);
  Serial.flush();
  delay(3);
}

#define MEASURE(name, before, statement)         \
  do {                                           \
    group(F(name));                              \
    for (uint8_t i = 0; i < N; i++) {            \
      before;                                    \
      MARK_ON();                                 \
      statement;                                 \
      MARK_OFF();                                \
      delayMicroseconds(300);                    \
    }                                            \
  } while (0)

#define MOTOR_AT(v) MEASURE("motorSet speed " #v, vSpeed = v, motorSet(5, 7, 4, vSpeed))
#define TONE_AT(hz) MEASURE("tone D10 fresh " #hz " Hz", (noTone(10), vHz = hz), tone(10, vHz, vMs))
#define RETONE_AT(hz) MEASURE("tone D10 replacing " #hz " Hz", (noTone(10), tone(10, 1000, 100UL), vHz = hz), tone(10, vHz, vMs))

void setup() {
  Serial.begin(9600);
  DDRB |= _BV(PB0);
  pinMode(5, OUTPUT);
  pinMode(7, OUTPUT);
  pinMode(4, OUTPUT);

  MEASURE("baseline", (void)0, (void)0);
  MEASURE("digitalWrite D7 HIGH", (void)0, digitalWrite(7, HIGH));
  MEASURE("digitalWrite D4 LOW", (void)0, digitalWrite(4, LOW));
  MEASURE("analogWrite D5 v=128", (void)0, analogWrite(5, vDuty));
  MEASURE("motorSet v=50", (void)0, motorSet(5, 7, 4, vSpeed));
  MEASURE("motorSet v=-100", (void)0, motorSet(5, 7, 4, vSpeedMinus));
  MOTOR_AT(-100);
  MOTOR_AT(-99);
  MOTOR_AT(-98);
  MOTOR_AT(-97);
  MOTOR_AT(-96);
  MOTOR_AT(-95);
  MOTOR_AT(-94);
  MOTOR_AT(-93);
  MOTOR_AT(-92);
  MOTOR_AT(-91);
  MOTOR_AT(-90);
  MOTOR_AT(-89);
  MOTOR_AT(-88);
  MOTOR_AT(-87);
  MOTOR_AT(-86);
  MOTOR_AT(-85);
  MOTOR_AT(-84);
  MOTOR_AT(-83);
  MOTOR_AT(-82);
  MOTOR_AT(-81);
  MOTOR_AT(-80);
  MOTOR_AT(-79);
  MOTOR_AT(-78);
  MOTOR_AT(-77);
  MOTOR_AT(-76);
  MOTOR_AT(-75);
  MOTOR_AT(-74);
  MOTOR_AT(-73);
  MOTOR_AT(-72);
  MOTOR_AT(-71);
  MOTOR_AT(-70);
  MOTOR_AT(-69);
  MOTOR_AT(-68);
  MOTOR_AT(-67);
  MOTOR_AT(-66);
  MOTOR_AT(-65);
  MOTOR_AT(-64);
  MOTOR_AT(-63);
  MOTOR_AT(-62);
  MOTOR_AT(-61);
  MOTOR_AT(-60);
  MOTOR_AT(-59);
  MOTOR_AT(-58);
  MOTOR_AT(-57);
  MOTOR_AT(-56);
  MOTOR_AT(-55);
  MOTOR_AT(-54);
  MOTOR_AT(-53);
  MOTOR_AT(-52);
  MOTOR_AT(-51);
  MOTOR_AT(-50);
  MOTOR_AT(-49);
  MOTOR_AT(-48);
  MOTOR_AT(-47);
  MOTOR_AT(-46);
  MOTOR_AT(-45);
  MOTOR_AT(-44);
  MOTOR_AT(-43);
  MOTOR_AT(-42);
  MOTOR_AT(-41);
  MOTOR_AT(-40);
  MOTOR_AT(-39);
  MOTOR_AT(-38);
  MOTOR_AT(-37);
  MOTOR_AT(-36);
  MOTOR_AT(-35);
  MOTOR_AT(-34);
  MOTOR_AT(-33);
  MOTOR_AT(-32);
  MOTOR_AT(-31);
  MOTOR_AT(-30);
  MOTOR_AT(-29);
  MOTOR_AT(-28);
  MOTOR_AT(-27);
  MOTOR_AT(-26);
  MOTOR_AT(-25);
  MOTOR_AT(-24);
  MOTOR_AT(-23);
  MOTOR_AT(-22);
  MOTOR_AT(-21);
  MOTOR_AT(-20);
  MOTOR_AT(-19);
  MOTOR_AT(-18);
  MOTOR_AT(-17);
  MOTOR_AT(-16);
  MOTOR_AT(-15);
  MOTOR_AT(-14);
  MOTOR_AT(-13);
  MOTOR_AT(-12);
  MOTOR_AT(-11);
  MOTOR_AT(-10);
  MOTOR_AT(-9);
  MOTOR_AT(-8);
  MOTOR_AT(-7);
  MOTOR_AT(-6);
  MOTOR_AT(-5);
  MOTOR_AT(-4);
  MOTOR_AT(-3);
  MOTOR_AT(-2);
  MOTOR_AT(-1);
  MOTOR_AT(0);
  MOTOR_AT(1);
  MOTOR_AT(2);
  MOTOR_AT(3);
  MOTOR_AT(4);
  MOTOR_AT(5);
  MOTOR_AT(6);
  MOTOR_AT(7);
  MOTOR_AT(8);
  MOTOR_AT(9);
  MOTOR_AT(10);
  MOTOR_AT(11);
  MOTOR_AT(12);
  MOTOR_AT(13);
  MOTOR_AT(14);
  MOTOR_AT(15);
  MOTOR_AT(16);
  MOTOR_AT(17);
  MOTOR_AT(18);
  MOTOR_AT(19);
  MOTOR_AT(20);
  MOTOR_AT(21);
  MOTOR_AT(22);
  MOTOR_AT(23);
  MOTOR_AT(24);
  MOTOR_AT(25);
  MOTOR_AT(26);
  MOTOR_AT(27);
  MOTOR_AT(28);
  MOTOR_AT(29);
  MOTOR_AT(30);
  MOTOR_AT(31);
  MOTOR_AT(32);
  MOTOR_AT(33);
  MOTOR_AT(34);
  MOTOR_AT(35);
  MOTOR_AT(36);
  MOTOR_AT(37);
  MOTOR_AT(38);
  MOTOR_AT(39);
  MOTOR_AT(40);
  MOTOR_AT(41);
  MOTOR_AT(42);
  MOTOR_AT(43);
  MOTOR_AT(44);
  MOTOR_AT(45);
  MOTOR_AT(46);
  MOTOR_AT(47);
  MOTOR_AT(48);
  MOTOR_AT(49);
  MOTOR_AT(50);
  MOTOR_AT(51);
  MOTOR_AT(52);
  MOTOR_AT(53);
  MOTOR_AT(54);
  MOTOR_AT(55);
  MOTOR_AT(56);
  MOTOR_AT(57);
  MOTOR_AT(58);
  MOTOR_AT(59);
  MOTOR_AT(60);
  MOTOR_AT(61);
  MOTOR_AT(62);
  MOTOR_AT(63);
  MOTOR_AT(64);
  MOTOR_AT(65);
  MOTOR_AT(66);
  MOTOR_AT(67);
  MOTOR_AT(68);
  MOTOR_AT(69);
  MOTOR_AT(70);
  MOTOR_AT(71);
  MOTOR_AT(72);
  MOTOR_AT(73);
  MOTOR_AT(74);
  MOTOR_AT(75);
  MOTOR_AT(76);
  MOTOR_AT(77);
  MOTOR_AT(78);
  MOTOR_AT(79);
  MOTOR_AT(80);
  MOTOR_AT(81);
  MOTOR_AT(82);
  MOTOR_AT(83);
  MOTOR_AT(84);
  MOTOR_AT(85);
  MOTOR_AT(86);
  MOTOR_AT(87);
  MOTOR_AT(88);
  MOTOR_AT(89);
  MOTOR_AT(90);
  MOTOR_AT(91);
  MOTOR_AT(92);
  MOTOR_AT(93);
  MOTOR_AT(94);
  MOTOR_AT(95);
  MOTOR_AT(96);
  MOTOR_AT(97);
  MOTOR_AT(98);
  MOTOR_AT(99);
  MOTOR_AT(100);
  TONE_AT(31);
  TONE_AT(100);
  TONE_AT(200);
  TONE_AT(440);
  TONE_AT(500);
  TONE_AT(1000);
  TONE_AT(1500);
  TONE_AT(3000);
  TONE_AT(4000);
  MEASURE("tone D10 replacing 1000 by 1500 Hz", (noTone(10), tone(10, 1000, 100UL), vHz = 1500), tone(10, vHz, vMs));
  RETONE_AT(31);
  RETONE_AT(100);
  RETONE_AT(200);
  RETONE_AT(440);
  RETONE_AT(500);
  RETONE_AT(1000);
  RETONE_AT(1500);
  RETONE_AT(3000);
  RETONE_AT(4000);
  noTone(10);
  MEASURE("Serial.begin 9600", Serial.flush(), Serial.begin(9600));
  group(F("loop"));
}

void loop() {
}
