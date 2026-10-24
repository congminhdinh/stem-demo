// R0.4 sketch 1: blink. D13 HIGH 500 ms, LOW 500 ms.
void setup() {
  pinMode(13, OUTPUT);
}

void loop() {
  digitalWrite(13, HIGH);
  delay(500);
  digitalWrite(13, LOW);
  delay(500);
}
