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

## 마스터 데이터 (참고: 프론트가 Supabase에서 직접 읽어도 됨)
`locations`, `time_slots`, `vehicles` 는 누구나 읽기 가능(RLS 허용). 예약 API는 Phase 4에서 추가됩니다.
