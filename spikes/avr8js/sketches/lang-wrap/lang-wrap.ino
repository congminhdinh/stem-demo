// R0.4 language sketch 2: which way of writing int32 wrap does avr-gcc 7.3 (-Os -flto) keep correct?
// Probes: x + 1 > x with x = INT32_MAX (wrap says 0), (h * 2) / 2 with h = 2^30 (wrap says -2^30),
// and a count that crosses INT32_MAX (wrap says it reaches INT32_MIN + 1).

volatile long vMax = 2147483647L;
volatile long v2pow30 = 1073741824L;
volatile long vOne = 1L;

// A: unsigned arithmetic, cast back (lang.ino showed GCC folds the comparison anyway).
static inline long aAdd(long a, long b) { return (long)((unsigned long)a + (unsigned long)b); }
static inline long aMul(long a, long b) { return (long)((unsigned long)a * (unsigned long)b); }
// B: GCC integer overflow builtins: the result is the infinite-precision result cast (modulo 2^32) to long.
static inline long bAdd(long a, long b) { long r; __builtin_add_overflow(a, b, &r); return r; }
static inline long bMul(long a, long b) { long r; __builtin_mul_overflow(a, b, &r); return r; }
// C: A, with an empty asm that hides the value from the optimiser.
static inline long cAdd(long a, long b) { long r = (long)((unsigned long)a + (unsigned long)b); __asm__("" : "+r"(r)); return r; }
static inline long cMul(long a, long b) { long r = (long)((unsigned long)a * (unsigned long)b); __asm__("" : "+r"(r)); return r; }
// D: A, never inlined.
__attribute__((noinline)) long dAdd(long a, long b) { return (long)((unsigned long)a + (unsigned long)b); }
__attribute__((noinline)) long dMul(long a, long b) { return (long)((unsigned long)a * (unsigned long)b); }

void kv(const __FlashStringHelper *key, long value) {
  Serial.print(key);
  Serial.print('=');
  Serial.println(value);
}

// The trap lang.ino fell into: a plain x + 1 in the same function, which GCC may merge (CSE) with the helper's
// value and then treat as not overflowing. One function per helper form, so the forms cannot meet.
void trapA() {
  long x = vMax;
  kv(F("trapA plain x+1"), x + 1L);
  kv(F("trapA x+1>x"), (aAdd(x, 1L) > x) ? 1L : 0L);
}
void trapB() {
  long x = vMax;
  kv(F("trapB plain x+1"), x + 1L);
  kv(F("trapB x+1>x"), (bAdd(x, 1L) > x) ? 1L : 0L);
}
void trapC() {
  long x = vMax;
  kv(F("trapC plain x+1"), x + 1L);
  kv(F("trapC x+1>x"), (cAdd(x, 1L) > x) ? 1L : 0L);
}
void trapD() {
  long x = vMax;
  kv(F("trapD plain x+1"), x + 1L);
  kv(F("trapD x+1>x"), (dAdd(x, 1L) > x) ? 1L : 0L);
}

void setup() {
  Serial.begin(9600);
  trapA();
  trapB();
  trapC();
  trapD();
  long x = vMax;
  long h = v2pow30;
  kv(F("plain x+1>x"), (x + 1L > x) ? 1L : 0L);
  kv(F("A x+1>x"), (aAdd(x, 1L) > x) ? 1L : 0L);
  kv(F("B x+1>x"), (bAdd(x, 1L) > x) ? 1L : 0L);
  kv(F("C x+1>x"), (cAdd(x, 1L) > x) ? 1L : 0L);
  kv(F("D x+1>x"), (dAdd(x, 1L) > x) ? 1L : 0L);
  kv(F("plain (h*2)/2"), (h * 2L) / 2L);
  kv(F("A (h*2)/2"), aMul(h, 2L) / 2L);
  kv(F("B (h*2)/2"), bMul(h, 2L) / 2L);
  kv(F("C (h*2)/2"), cMul(h, 2L) / 2L);
  kv(F("D (h*2)/2"), dMul(h, 2L) / 2L);
  // A counter that steps past INT32_MAX: wrap says the loop sees a negative value and stops at 3 steps.
  long steps = 0L;
  for (long c = vMax - 1L; c > 0L; c = bAdd(c, vOne)) { steps = bAdd(steps, 1L); if (steps > 5L) break; }
  kv(F("B steps past max"), steps);
  steps = 0L;
  for (long c = vMax - 1L; c > 0L; c = aAdd(c, vOne)) { steps = aAdd(steps, 1L); if (steps > 5L) break; }
  kv(F("A steps past max"), steps);
  steps = 0L;
  for (long c = vMax - 1L; c > 0L; c = c + vOne) { steps = steps + 1L; if (steps > 5L) break; }
  kv(F("plain steps past max"), steps);
  Serial.println(F("done"));
}

void loop() {
}
