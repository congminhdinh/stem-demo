// N18 C1: in which order does avr-gcc 7.3 (arduino:avr@1.8.8, -Os -flto, gnu++11) evaluate the operands the generator writes? C++
// leaves the order of a call's arguments and of a comparison's operands open; the interpreter evaluates left to right. `se` prints its
// value when it is evaluated. Not part of run-all.mjs; node spikes/avr8js/run-eval-order.mjs prints the serial lines.
long add32(long a, long b) { return (long)((unsigned long)a + (unsigned long)b); }
long sub32(long a, long b) { return (long)((unsigned long)a - (unsigned long)b); }
long mul32(long a, long b) { return (long)((unsigned long)a * (unsigned long)b); }
long se(long v) { Serial.print(F("eval=")); Serial.println(v); return v; }
void f3(uint8_t pin, long a, long b) { Serial.print(F("f3 ")); Serial.print(pin); Serial.print(F(" ")); Serial.print(a); Serial.print(F(" ")); Serial.println(b); }
long x = 0L;
void setup() {
  Serial.begin(9600);
  Serial.println(F("#add"));
  Serial.println(add32(se(1L), se(2L)));
  Serial.println(F("#sub"));
  x = sub32(se(3L), se(4L));
  Serial.println(x);
  Serial.println(F("#cmp"));
  Serial.println((se(5L) < se(6L)));
  Serial.println(F("#three"));
  f3(10, se(7L), se(8L));
  Serial.println(F("#nested"));
  Serial.println(add32(mul32(se(9L), se(10L)), se(11L)));
  Serial.println(F("#end"));
}
void loop() {
}
