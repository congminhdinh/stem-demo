// R0.4 size sketch: a global buffer of BIG bytes (set with -DBIG=<n> at compile time), to find where
// arduino-cli starts to warn "Low memory available" for the UNO.
#ifndef BIG
#define BIG 1000
#endif
volatile uint8_t big[BIG];

void setup() {
  for (unsigned int i = 0; i < BIG; i++) big[i] = (uint8_t)i;
}

void loop() {
}
