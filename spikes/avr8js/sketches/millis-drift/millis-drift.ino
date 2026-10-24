// R0.4 extra sketch: millis() against true elapsed time. D8 (PB0) toggles right before each read; the harness
// takes the toggle's cycle as the read's time. 250 reads about 4 ms apart, printed after the run.
volatile unsigned long samples[250];

void setup() {
  Serial.begin(9600);
  DDRB |= _BV(PB0);
  for (uint8_t i = 0; i < 250; i++) {
    PINB = _BV(PB0);
    samples[i] = millis();
    delayMicroseconds(3999);
  }
  for (uint8_t i = 0; i < 250; i++) {
    Serial.println(samples[i]);
  }
}

void loop() {
}
