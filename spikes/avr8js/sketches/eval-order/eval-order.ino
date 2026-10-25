// N18 C1: in which order does avr-gcc 7.3 (arduino:avr@1.8.8, -Os -flto, gnu++11) evaluate the operands the generator writes? C++
// leaves the order of a call's arguments and of a comparison's operands open; the interpreter evaluates left to right. `se` / `sb`
// print their value when they are evaluated. Part 1: the plain forms. Part 2: the sequenced form of contract UNO 0.1.3 (§3.5): each
// read assigned to a function-scope temporary with the comma operator, `&&` / `||` native. Not part of run-all.mjs;
// node spikes/avr8js/run-eval-order.mjs prints the serial lines.
long add32(long a, long b) { return (long)((unsigned long)a + (unsigned long)b); }
long sub32(long a, long b) { return (long)((unsigned long)a - (unsigned long)b); }
long mul32(long a, long b) { return (long)((unsigned long)a * (unsigned long)b); }
long se(long v) { Serial.print(F("eval=")); Serial.println(v); return v; }
bool sb(bool v) { Serial.print(F("evalb=")); Serial.println(v); return v; }
void f3(uint8_t pin, long a, long b) { Serial.print(F("f3 ")); Serial.print(pin); Serial.print(F(" ")); Serial.print(a); Serial.print(F(" ")); Serial.println(b); }
long x = 0L;
void setup() {
  Serial.begin(9600);
  long _s1;
  long _s2;
  long _s3;
  bool _s4;
  bool _s5;
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
  Serial.println(F("#seq-add"));
  Serial.println((_s1 = se(1L), _s2 = se(2L), add32(_s1, _s2)));
  Serial.println(F("#seq-sub"));
  x = (_s1 = se(3L), _s2 = se(4L), sub32(_s1, _s2));
  Serial.println(x);
  Serial.println(F("#seq-cmp"));
  Serial.println((_s1 = se(5L), _s2 = se(6L), (_s1 < _s2)));
  Serial.println(F("#seq-three"));
  (_s1 = se(7L), _s2 = se(8L), f3(10, _s1, _s2));
  Serial.println(F("#seq-nested"));
  Serial.println((_s1 = se(9L), _s2 = se(10L), _s3 = se(11L), add32(mul32(_s1, _s2), _s3)));
  Serial.println(F("#seq-while"));
  x = 0L;
  while ((_s1 = se(x), _s2 = se(2L), (_s1 < _s2))) {
    x = add32(x, 1L);
  }
  Serial.println(x);
  Serial.println(F("#and-or"));
  Serial.println((sb(false) && sb(true)));
  Serial.println((sb(true) || sb(false)));
  Serial.println(F("#seq-logic"));
  Serial.println((_s4 = (sb(true) && sb(false)), _s5 = sb(true), (_s4 == _s5)));
  Serial.println(F("#end"));
}
void loop() {
}
