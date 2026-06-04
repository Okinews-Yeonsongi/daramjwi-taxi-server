#ifndef cbi
#define cbi(sfr, bit) (_SFR_BYTE(sfr) &= ~_BV(bit))
#endif
#ifndef sbi
#define sbi(sfr, bit) (_SFR_BYTE(sfr) |= _BV(bit))
#endif

#define AIN1 4
#define BIN1 6
#define AIN2 3
#define BIN2 7
#define PWMA 9
#define PWMB 10

bool isBlackLine = 1;
unsigned int lineThickness = 15;
unsigned int numSensors = 5;

int P, D, I, previousError, PIDvalue;
double error;
int lsp, rsp;

int lfSpeed = 55;
int currentSpeed = 55;

// 급커브에서 안쪽 바퀴가 뒤로 돌 수 있는 한계(음수). 못 꺾으면 더 내림(-100), 과하면 0~-40
int minTurnSpeed = -80;

// 라인 놓쳤을 때 제자리 회전 속도 (전진 성분 없음 → 왔던 길로 안 돌아감)
int searchSpeed = 60;

int sensorWeight[7] = { 4, 2, 1, 0, -1, -2, -4 };
int activeSensors;

float Kp = 0.06;
float Kd = 0.15;
float Ki = 0;

// 출력 평활화: 직선 떨림은 줄이지만 너무 크면 코너 반응이 느려짐. 코너 못 돌면 0.2 이하로
float smoothing = 0.25;
int lastPID = 0;

// ★ 마지막으로 본 라인 방향 기억: +1=왼쪽, -1=오른쪽
int lastDir = 1;

int onLine = 1;
int minValues[7], maxValues[7], threshold[7], sensorValue[7], sensorArray[7];

void setup() {
  sbi(ADCSRA, ADPS2);
  cbi(ADCSRA, ADPS1);
  cbi(ADCSRA, ADPS0);

  Serial.begin(9600);

  pinMode(AIN1, OUTPUT);
  pinMode(AIN2, OUTPUT);
  pinMode(BIN1, OUTPUT);
  pinMode(BIN2, OUTPUT);
  pinMode(PWMA, OUTPUT);
  pinMode(PWMB, OUTPUT);
  pinMode(11, INPUT_PULLUP);
  pinMode(12, INPUT_PULLUP);
  pinMode(13, OUTPUT);

  pinMode(5, OUTPUT);
  digitalWrite(5, HIGH);

  lineThickness = constrain(lineThickness, 10, 35);

  if (numSensors == 5) {
    sensorWeight[1] = 4;
    sensorWeight[5] = -4;
  }
}

void loop() {
  while (digitalRead(11)) {}
  delay(1000);
  calibrate();

  while (digitalRead(12)) {}
  delay(1000);

  while (1) {
    readLine();

    currentSpeed = lfSpeed;

    if (onLine == 1) {
      linefollow();
      digitalWrite(13, HIGH);
    } else {
      // ★ 라인 이탈 → 마지막 방향으로 "제자리" 회전 (전진 X → 왔던 길로 복귀 방지)
      digitalWrite(13, LOW);
      if (lastDir > 0) {
        motor1run(-searchSpeed);   // 왼쪽으로 제자리 회전
        motor2run(searchSpeed);
      } else {
        motor1run(searchSpeed);    // 오른쪽으로 제자리 회전
        motor2run(-searchSpeed);
      }
    }
  }
}

void linefollow() {
  error = 0;
  activeSensors = 0;

  if (numSensors == 7) {
    for (int i = 0; i < 7; i++) {
      error += sensorWeight[i] * sensorArray[i] * sensorValue[i];
      activeSensors += sensorArray[i];
    }
    if (activeSensors != 0) error = error / activeSensors;
  }

  if (numSensors == 5) {
    for (int i = 1; i < 6; i++) {
      error += sensorWeight[i] * sensorArray[i] * sensorValue[i];
      activeSensors += sensorArray[i];
    }
    if (activeSensors != 0) error = error / activeSensors;
  }

  // ★ 라인이 한쪽으로 충분히 치우치면 그 방향을 기억 (이탈 복구 방향용)
  if (error > 300) lastDir = 1;        // 라인 왼쪽
  else if (error < -300) lastDir = -1; // 라인 오른쪽

  P = error;
  I = I + error;
  D = error - previousError;

  PIDvalue = (Kp * P) + (Ki * I) + (Kd * D);
  previousError = error;

  // 출력 평활화
  PIDvalue = (int)(smoothing * lastPID + (1.0 - smoothing) * PIDvalue);
  lastPID = PIDvalue;

  lsp = currentSpeed - PIDvalue;
  rsp = currentSpeed + PIDvalue;

  // ★ 안쪽 바퀴 역회전 허용 → 급커브에서 급선회
  lsp = constrain(lsp, minTurnSpeed, 255);
  rsp = constrain(rsp, minTurnSpeed, 255);

  motor1run(lsp);
  motor2run(rsp);
}

void calibrate() {
  for (int i = 0; i < 7; i++) {
    minValues[i] = analogRead(i);
    maxValues[i] = analogRead(i);
  }

  for (int i = 0; i < 10000; i++) {
    motor1run(40);
    motor2run(-40);

    for (int i = 0; i < 7; i++) {
      int sensorReading = analogRead(i);

      if (sensorReading < minValues[i]) {
        minValues[i] = sensorReading;
      }
      if (sensorReading > maxValues[i]) {
        maxValues[i] = sensorReading;
      }
    }
  }

  for (int i = 0; i < 7; i++) {
    threshold[i] = (minValues[i] + maxValues[i]) / 2;
    Serial.print(threshold[i]);
    Serial.print(" ");
  }
  Serial.println();

  motor1run(0);
  motor2run(0);
}

void readLine() {
  onLine = 0;

  if (numSensors == 7) {
    for (int i = 0; i < 7; i++) {
      if (isBlackLine) {
        sensorValue[i] = map(analogRead(i), minValues[i], maxValues[i], 0, 1000);
      } else {
        sensorValue[i] = map(analogRead(i), minValues[i], maxValues[i], 1000, 0);
      }

      sensorValue[i] = constrain(sensorValue[i], 0, 1000);
      sensorArray[i] = sensorValue[i] > 500;

      if (sensorArray[i]) onLine = 1;
    }
  }

  if (numSensors == 5) {
    for (int i = 1; i < 6; i++) {
      if (isBlackLine) {
        sensorValue[i] = map(analogRead(i), minValues[i], maxValues[i], 0, 1000);
      } else {
        sensorValue[i] = map(analogRead(i), minValues[i], maxValues[i], 1000, 0);
      }

      sensorValue[i] = constrain(sensorValue[i], 0, 1000);
      sensorArray[i] = sensorValue[i] > 500;

      if (sensorArray[i]) onLine = 1;
    }
  }
}

void motor1run(int motorSpeed) {
  motorSpeed = constrain(motorSpeed, -255, 255);

  if (motorSpeed > 0) {
    digitalWrite(AIN1, 1);
    digitalWrite(AIN2, 0);
    analogWrite(PWMA, motorSpeed);
  } else if (motorSpeed < 0) {
    digitalWrite(AIN1, 0);
    digitalWrite(AIN2, 1);
    analogWrite(PWMA, abs(motorSpeed));
  } else {
    digitalWrite(AIN1, 1);
    digitalWrite(AIN2, 1);
    analogWrite(PWMA, 0);
  }
}

void motor2run(int motorSpeed) {
  motorSpeed = constrain(motorSpeed, -255, 255);

  if (motorSpeed > 0) {
    digitalWrite(BIN1, 1);
    digitalWrite(BIN2, 0);
    analogWrite(PWMB, motorSpeed);
  } else if (motorSpeed < 0) {
    digitalWrite(BIN1, 0);
    digitalWrite(BIN2, 1);
    analogWrite(PWMB, abs(motorSpeed));
  } else {
    digitalWrite(BIN1, 1);
    digitalWrite(BIN2, 1);
    analogWrite(PWMB, 0);
  }
}
