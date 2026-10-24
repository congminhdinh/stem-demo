// R0.4 language sketch: the int32 rules of the UNO contract as the board computes them.
// Every input is volatile, so the compiler cannot compute a result at build time unless the line says so.
// "plain" lines use C++ operators on long; "helper" lines use the unsigned-arithmetic helpers the contract
// proposes (y*), which are defined for every input. Output: one "key=value" line each.

volatile long vMax = 2147483647L;
volatile long vMin = -2147483647L - 1L;
volatile long vM1 = -1L;
volatile long vZero = 0L;
volatile long v7 = 7L;
volatile long vNeg7 = -7L;
volatile long v2 = 2L;
volatile long vNeg2 = -2L;
volatile long v2pow30 = 1073741824L;
volatile unsigned long vU2pow31 = 2147483648UL;
volatile long vNeg1 = -1L;

// Wrapping int32 arithmetic without undefined behaviour: unsigned long arithmetic is modulo 2^32 (C++11
// [basic.fundamental]/4), and GCC converts an out-of-range unsigned value to long modulo 2^32 (GCC manual,
// "Integers implementation").
static inline long yAdd(long a, long b) { return (long)((unsigned long)a + (unsigned long)b); }
static inline long ySub(long a, long b) { return (long)((unsigned long)a - (unsigned long)b); }
static inline long yMul(long a, long b) { return (long)((unsigned long)a * (unsigned long)b); }
static inline long yNeg(long a) { return (long)(0UL - (unsigned long)a); }
// Division: b == -1 is negation (INT32_MIN / -1 wraps to INT32_MIN; x % -1 is 0); b == 0 never reaches the
// board in a run the simulator accepts (out-of-domain), and returns 0 so the board stays defined.
static inline long yDiv(long a, long b) { return b == -1L ? yNeg(a) : (b == 0L ? 0L : a / b); }
static inline long yMod(long a, long b) { return (b == -1L || b == 0L) ? 0L : a % b; }

void kv(const __FlashStringHelper *key, long value) {
  Serial.print(key);
  Serial.print('=');
  Serial.println(value);
}

long trace = 0L;
long startBound() { Serial.println(F("eval=start")); return 1L; }
long endBound() { Serial.println(F("eval=end")); return 3L; }

void setup() {
  Serial.begin(9600);

  // Literals: int is 16 bits on AVR. Without L the product is int arithmetic.
  kv(F("int 300*200"), 300 * 200);
  kv(F("long 300L*200L"), 300L * 200L);

  // Overflow.
  long x = vMax;
  kv(F("plain max+1"), x + 1L);
  kv(F("helper max+1"), yAdd(x, 1L));
  kv(F("plain (x+1>x)"), (x + 1L > x) ? 1L : 0L);
  kv(F("helper (x+1>x)"), (yAdd(x, 1L) > x) ? 1L : 0L);
  long h = v2pow30;
  kv(F("plain (h*2)/2"), (h * 2L) / 2L);
  kv(F("helper (h*2)/2"), yDiv(yMul(h, 2L), 2L));
  kv(F("plain -min"), -vMin);
  kv(F("helper -min"), yNeg(vMin));
  kv(F("plain 65536*65536"), v2pow30 / 16384L * 65536L);
  kv(F("helper 65536*65536"), yMul(yDiv(v2pow30, 16384L), 65536L));

  // Division truncates toward zero; % takes the sign of the dividend (C++11 [expr.mul]/4).
  kv(F("-7/2"), vNeg7 / v2);
  kv(F("-7%2"), vNeg7 % v2);
  kv(F("7/-2"), v7 / vNeg2);
  kv(F("7%-2"), v7 % vNeg2);
  kv(F("-7/-2"), vNeg7 / vNeg2);
  kv(F("-7%-2"), vNeg7 % vNeg2);
  kv(F("helper -7/2"), yDiv(vNeg7, v2));
  kv(F("helper -7%2"), yMod(vNeg7, v2));
  kv(F("helper 7%-2"), yMod(v7, vNeg2));

  // The two undefined cases of [expr.mul]/4, and division by zero, as the library routine computes them.
  kv(F("plain min/-1"), vMin / vM1);
  kv(F("plain min%-1"), vMin % vM1);
  kv(F("plain 7%-1"), v7 % vM1);
  kv(F("plain -7%-1"), vNeg7 % vM1);
  kv(F("plain 7/0"), v7 / vZero);
  kv(F("plain -7/0"), vNeg7 / vZero);
  kv(F("plain 7%0"), v7 % vZero);
  kv(F("plain -7%0"), vNeg7 % vZero);
  kv(F("helper min/-1"), yDiv(vMin, vM1));
  kv(F("helper min%-1"), yMod(vMin, vM1));
  kv(F("helper -7%-1"), yMod(vNeg7, vM1));
  kv(F("helper 7/0"), yDiv(v7, vZero));
  kv(F("helper 7%0"), yMod(v7, vZero));

  // Booleans print as 1 / 0 (Print has no bool overload: bool promotes to int).
  Serial.print(F("bool true="));
  Serial.println(true);
  Serial.print(F("bool false="));
  Serial.println(false);
  Serial.print(F("bool 7>2="));
  Serial.println(v7 > v2);
  Serial.print(F("bool !(7>2)="));
  Serial.println(!(v7 > v2));

  // millis() is unsigned long: compared with a negative long, the long converts to unsigned.
  long minusOne = vNeg1;
  kv(F("(-1 < millis())"), (minusOne < millis()) ? 1L : 0L);
  kv(F("(-1 < (long)millis())"), (minusOne < (long)millis()) ? 1L : 0L);
  kv(F("(long)2147483648UL"), (long)vU2pow31);

  // Count up, the contract form: start, then end, each once; the variable keeps the last value.
  long i = 99L;
  {
    const long _from = (startBound());
    const long _to = (endBound());
    for (long _c = _from; _c <= _to; _c += 1L) {
      i = _c;
      Serial.print(F("body i="));
      Serial.println(i);
    }
  }
  kv(F("after i"), i);
  // Count up, the brief's literal form: the end is evaluated before the start.
  long j = 99L;
  {
    const long _to = (endBound());
    for (long _c = (startBound()); _c <= _to; _c += 1L) {
      j = _c;
    }
  }
  kv(F("after j"), j);
  // Count up with start > end: no iteration, the variable keeps its value.
  long k = 42L;
  {
    const long _from = (v7);
    const long _to = (v2);
    for (long _c = _from; _c <= _to; _c += 1L) {
      k = _c;
    }
  }
  kv(F("after k (7..2)"), k);
  // Count up whose body changes the variable the end was read from: the end was read once.
  long limit = 3L;
  long count = 0L;
  {
    const long _from = (1L);
    const long _to = (limit);
    for (long _c = _from; _c <= _to; _c += 1L) {
      count = yAdd(count, 1L);
      limit = 10L;
    }
  }
  kv(F("count (end read once)"), count);

  // Text is printed from flash.
  Serial.println(F("text=Xin chao"));
  Serial.println(F("utf8=Xin chào"));
  Serial.println(F("done"));
}

void loop() {
}
