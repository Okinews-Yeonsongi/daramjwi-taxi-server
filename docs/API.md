# 다람쥐 택시 API 명세 (프론트엔드 연동용)

프론트엔드(`daramjwi-taxi-client`)가 이 백엔드를 호출할 때 참고하는 문서입니다.

- **Base URL**: 로컬 `http://localhost:3000`, 배포 후엔 Vercel 주소
- **인증**: 로그인 후 받은 `access_token` 을 모든 보호된 요청에 헤더로 첨부
  ```
  Authorization: Bearer <access_token>
  ```
- **요청/응답 형식**: JSON (`Content-Type: application/json`)
- **에러 응답 공통 형식**:
  ```json
  { "error": "사람이 읽을 한글 메시지", "code": "OPTIONAL_CODE" }
  ```

---

## 인증 흐름 (OTP = 문자 인증)

```
1) request-otp  : 전화번호 입력 → 문자로 인증번호 발송
2) verify-otp   : 인증번호 입력 → 로그인 성공, 토큰 발급
                  (profile 없으면 needsOnboarding=true)
3) (신규만) POST /api/profile : 이름·주소 입력해서 가입 완료
```
같은 전화번호는 어느 기기에서 로그인해도 **같은 계정**으로 연결됩니다. (폰 교체 OK)

---

### 1. POST `/api/auth/request-otp`
인증번호(문자) 발송. 계정이 없으면 자동 생성됩니다.

**요청**
```json
{ "phone": "010-1234-5678" }
```
**응답 200**
```json
{ "success": true, "message": "인증번호를 문자로 보냈어요." }
```
**에러**: `400` 번호 형식 오류 / `502` 발송 실패(`OTP_SEND_FAILED`)

---

### 2. POST `/api/auth/verify-otp`
인증번호 검증 + 로그인.

**요청**
```json
{ "phone": "010-1234-5678", "code": "123456" }
```
**응답 200**
```json
{
  "session": {
    "access_token": "eyJ...",
    "refresh_token": "...",
    "expires_at": 1700000000,
    "expires_in": 3600,
    "token_type": "bearer"
  },
  "user": { "id": "uuid", "phone": "01012345678" },
  "profile": null,
  "needsOnboarding": true
}
```
- `needsOnboarding: true` → 신규 사용자. 이름/주소 입력 화면으로 보낸 뒤 `POST /api/profile` 호출.
- `needsOnboarding: false` → 기존 사용자. `profile` 에 정보가 들어옴. 바로 홈으로.
- 프론트는 `access_token`(과 `refresh_token`)을 저장해두고 이후 요청에 사용합니다.

**에러**: `400` 입력 누락 / `401` 인증번호 오류·만료(`OTP_INVALID`)

---

### 3. GET `/api/auth/me`  🔒
현재 로그인한 사용자 + 프로필 조회.

**헤더**: `Authorization: Bearer <access_token>`

**응답 200**
```json
{
  "user": { "id": "uuid", "phone": "01012345678" },
  "profile": {
    "id": "uuid", "phone": "01012345678", "name": "홍길동",
    "address": "청산면 ...", "role": "resident", "status": "active",
    "created_at": "...", "updated_at": "..."
  },
  "needsOnboarding": false
}
```
**에러**: `401` 로그인 필요

---

### 4. POST `/api/profile`  🔒
온보딩(최초 프로필 생성). **전화번호는 인증된 값으로 자동 저장**되므로 보내지 않습니다.

**헤더**: `Authorization: Bearer <access_token>`
**요청**
```json
{ "name": "홍길동", "address": "청산면 ○○리 1-2" }
```
**응답 201**
```json
{ "profile": { "id": "uuid", "name": "홍길동", ... }, "created": true }
```
- 이미 프로필이 있으면 `200 { "profile": {...}, "created": false }` 반환(중복 제출 안전).

**에러**: `400` 이름 누락 / `401` 로그인 필요

---

### 5. PATCH `/api/profile`  🔒
프로필 수정 (전화번호는 변경 불가).

**헤더**: `Authorization: Bearer <access_token>`
**요청** (바꿀 항목만)
```json
{ "name": "홍길동", "address": "새 주소" }
```
**응답 200**
```json
{ "profile": { ... } }
```

---

## 마스터 데이터 (로그인 불필요)

### 6. GET `/api/locations`
활성 장소 목록. 카테고리·표시순서로 정렬되어 있고, 카테고리별로도 묶어서 줍니다.

**응답 200**
```json
{
  "locations": [
    { "id": 1, "category": "cheongsanmyeon", "name": "우리집", "emoji": "🏠", "display_order": 1 },
    { "id": 4, "category": "eupnae", "name": "옥천성모병원", "emoji": "🏥", "display_order": 1 }
  ],
  "byCategory": {
    "cheongsanmyeon": [ { "id": 1, "name": "우리집", ... }, ... ],
    "eupnae": [ { "id": 4, "name": "옥천성모병원", ... }, ... ]
  }
}
```
- `category` 값: `"cheongsanmyeon"`(청산면) / `"eupnae"`(읍내)

### 7. GET `/api/time-slots`
운행 시간 슬롯(9~18시) 목록.

**응답 200**
```json
{
  "timeSlots": [
    { "hour": 9, "label": "오전 9시" },
    { "hour": 10, "label": "오전 10시" },
    { "hour": 18, "label": "오후 6시" }
  ]
}
```

---

---

## 예약 신청 (주민용) 🔒

### ⭐ 권장 화면 흐름 (중요)
가용성(`/api/availability`)은 **날짜 + 출발지역(origin)** 이 있어야 계산되므로,
**출발지를 시간보다 먼저** 고르는 흐름을 권장합니다:

```
1) 날짜 선택
2) 출발지 선택 (청산면/읍내)         ← origin 확정
3) 도착지 선택 (반대편 자동)          ← 가용성엔 영향 없음(카테고리 단위)
4) 시간 선택  → GET /api/availability?date=&origin=  (마감 슬롯 회색 처리)
5) 인원 선택  → GET /api/availability/seats?date=&hour=&origin=  (1~N 제한)
6) 신청       → POST /api/reservations
```
- 도착지는 가용성에 영향을 주지 않으므로 4단계 뒤로 빼도 됩니다(자유).
- 어떤 순서로 하든 **마지막 POST가 최종 검증**(마감 → `NO_VEHICLE` 등)을 하니 안전합니다.

### 8. GET `/api/availability?date=YYYY-MM-DD&origin=cheongsanmyeon`
그 날짜+출발지의 시간대별 잔여석/마감 여부.

**응답 200**
```json
{
  "date": "2026-05-23",
  "origin": "cheongsanmyeon",
  "slots": [
    { "hour": 9,  "remaining": 4, "available": true,  "isPast": false },
    { "hour": 10, "remaining": 0, "available": false, "isPast": false },
    { "hour": 13, "remaining": 2, "available": true,  "isPast": false }
  ]
}
```
- `remaining`: 한 번에 신청 가능한 최대 인원(0~4) · `available`: 신청 가능 여부 · `isPast`: 지난 시간
- `origin`: `"cheongsanmyeon"` 또는 `"eupnae"`

### 9. GET `/api/availability/seats?date=YYYY-MM-DD&hour=10&origin=cheongsanmyeon`
인원 선택 단계용 — 특정 시간의 잔여석.

**응답 200**
```json
{ "date": "2026-05-23", "origin": "cheongsanmyeon", "hour": 10, "remaining": 2, "maxPersons": 2, "available": true }
```

### 10. POST `/api/reservations`
예약 신청. 차량은 시스템이 자동 배정(합승 우선 → A 우선)하며, **대기(waiting)** 상태로 생성됩니다.

**요청**
```json
{ "date": "2026-05-23", "hour": 10, "departure_id": 1, "arrival_id": 4, "persons": 2 }
```
**응답 201**
```json
{ "reservation": { "id": 12, "status": "waiting", "vehicle_id": 1, "hour": 10, "persons": 2, ... } }
```
**에러**
| status | code | 의미 |
|---|---|---|
| 400 | — | 날짜/시간/인원/지역 입력 오류, 7일 범위·지난 시간 |
| 400 | `SAME_CATEGORY` | 출발·도착이 같은 지역 |
| 409 | `NO_VEHICLE` | 마감(방금 다른 분이 예약) |
| 401 | — | 로그인 필요 |

### 11. GET `/api/reservations/me`  🔒
내 예약 목록 (오늘 이후, 취소 제외). 장소명·시간라벨·차량코드까지 채워서 줍니다.

**응답 200**
```json
{
  "reservations": [
    {
      "id": 12,
      "reservation_date": "2026-05-23",
      "hour": 10,
      "time_label": "오전 10시",
      "persons": 2,
      "status": "waiting",
      "departure": { "id": 1, "name": "우리집", "emoji": "🏠", "category": "cheongsanmyeon" },
      "arrival": { "id": 4, "name": "옥천성모병원", "emoji": "🏥", "category": "eupnae" },
      "vehicle_code": "A",
      "confirmed_at": null, "cancelled_at": null, "cancel_reason": null,
      "created_at": "..."
    }
  ]
}
```

### 12. PATCH `/api/reservations/:id/cancel`  🔒
본인 예약 취소. **운행 시작 시각 이후엔 취소 불가.**

**응답 200**
```json
{ "reservation": { "id": 12, "status": "cancelled", "cancelled_at": "...", ... } }
```
**에러**
| status | 의미 |
|---|---|
| 400 | 이미 취소/완료된 예약, 또는 이미 운행 시작됨 |
| 404 | 내 예약 중 그 id 없음 |
| 401 | 로그인 필요 |

---

## 운행·통계 (주민용) 🔒

### 13. GET `/api/runs/today`
오늘 전체 운행 일정. **차량(A/B) 식별과 개인정보는 노출하지 않습니다.**

**응답 200**
```json
{
  "date": "2026-05-22",
  "runs": [
    { "hour": 10, "time_label": "오전 10시", "origin": "cheongsanmyeon", "destination": "eupnae", "persons": 3, "seats_left": 1 },
    { "hour": 14, "time_label": "오후 2시", "origin": "eupnae", "destination": "cheongsanmyeon", "persons": 1, "seats_left": 3 }
  ]
}
```

### 14. GET `/api/stats/village`
마을 현황. `daily.used`/`monthly.used`는 **확정된 "운행 횟수"**(차 출발 수)예요 — **합승은 1회**로 계산.

**응답 200**
```json
{
  "date": "2026-05-22",
  "fare": 1700,
  "daily":   { "used": 1, "limit": 4,   "remaining": 3 },
  "monthly": { "used": 30, "limit": 112, "remaining": 82 }
}
```

---

## 이장님(관리자)용 🔒(admin)
모든 관리자 API는 `role='admin'` 인 계정의 토큰이 필요합니다. (아니면 403)

### 15. GET `/api/admin/dashboard`
오늘 요약. `{ date, fare, today: { waiting, confirmed, cancelled, completed, confirmed_persons }, limits: { daily, monthly } }`

### 16. GET `/api/admin/reservations?status=waiting&date=YYYY-MM-DD`
예약 필터 조회(둘 다 선택). 각 항목에 `resident:{name,phone}`, `departure/arrival`, `time_label`, `vehicle_code`, `cancel_reason` 포함.

### 17. PATCH `/api/admin/reservations/:id/confirm`
대기 예약 확정. **운행 한도(일 4회 / 월 112회, 합승은 1회로 계산)** 초과 시 `409`(code `DAILY_LIMIT`/`MONTHLY_LIMIT`). 단, 이미 확정된 같은 운행에 **합승 합류**하는 확정은 한도를 소모하지 않습니다. 성공 시 주민에게 확정 문자(현재 스텁).
응답: `{ reservation: {...status:"confirmed"...} }`

### 18. PATCH `/api/admin/reservations/:id/cancel`
body: `{ reason: string }` **(사유 필수)**. 대기/확정 예약 취소 → 주민에게 사유 포함 문자(스텁). 사유 없으면 `400`.

### 19. GET `/api/admin/profiles`
주민 목록 + `confirmed_count`(확정 누적 횟수).

### 20. GET `/api/admin/stats?month=YYYY-MM`
월 통계(생략 시 이번 달).
`{ month, totals: {waiting,confirmed,cancelled,completed}(예약 건수), confirmed_persons, confirmed_runs(확정 운행 횟수, 합승 1회), by_day: [{date, runs}] }`

---

> **SMS 실제 발송**은 **Phase 8**(CoolSMS 연결)에서, **PWA/아이콘**은 프론트 레포 담당입니다.
> 현재 확정/취소 시 문자는 서버 로그로 대체(스텁)되어 있습니다.
