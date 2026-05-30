# 🐿️ 다람쥐 택시 — 프론트엔드 인계 문서

> **백엔드 저장소:** https://github.com/Okinews-Yeonsongi/daramjwi-taxi-server
> **테스트 콘솔(UI 참고용):** [`/dev-console.html`](../public/dev-console.html)
> **인계 시점:** 2026-05-30
> **상태:** 모든 API + DB + RLS + Realtime 완성, 로컬 테스트 PASS

이 문서 하나만 보고 프론트가 백엔드에 바로 붙일 수 있게 작성되었습니다.

---

## 📐 1. 개요

충북 옥천군 청산면 마을 공유 택시 예약 시스템의 **백엔드**.

- **스택**: Next.js 15 App Router (Route Handlers) + Supabase (Postgres + Auth + RLS + Realtime)
- **차량**: 2대 (A, B), 각 정원 4명
- **운행**: 09~18시, 1시간 단위
- **거점**: 청산면(청산면사무소·백운리마을회관·백운사·청산고등학교) ↔ 읍내
- **한도**: 일 4회 운행 / 월 112회 운행 (합승은 1회로 카운트)

---

## ⚡ 2. 빠른 시작

### 2.1 클론 + 의존성
```bash
git clone https://github.com/Okinews-Yeonsongi/daramjwi-taxi-server.git
cd daramjwi-taxi-server
npm install
```

### 2.2 환경변수 — `.env.local`
```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxxxx
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxxx     # 서버 전용 — 절대 클라이언트에 노출 금지
```
> 키는 **백엔드 담당(현 사장님)에게 별도 채널**로 받으세요. Supabase 대시보드 → Settings → API 에서 발급됩니다.

### 2.3 실행
```bash
npm run dev      # http://localhost:3000
```

### 2.4 헬스 체크
```bash
curl http://localhost:3000/api/health
# → { "ok": true, "version": "..." }
```

---

## 🧱 3. 아키텍처 한 장 요약

```
┌─────────────────┐         Bearer JWT          ┌──────────────────┐
│   Frontend      │ ──────────────────────────► │  /api/* (Next.js)│
│ (Next.js 다른   │  Authorization: Bearer ...  │  Route Handlers  │
│  레포 or 같이)  │                              │                  │
│                 │ ◄─────────────────────────── │  RLS-aware       │
│ supabase-js     │       JSON response          │  supabase client │
│ Realtime ◄──────────── postgres_changes ──────────────► Postgres │
└─────────────────┘                              └──────────────────┘
                                                          │
                                                          ▼
                                                   ┌──────────────┐
                                                   │  Supabase    │
                                                   │  - Auth      │
                                                   │  - Postgres  │
                                                   │  - RLS       │
                                                   │  - Realtime  │
                                                   └──────────────┘
```

- 모든 비즈니스 로직은 **Postgres 함수(`create_reservation_atomic`, `assign_vehicle`, `vehicle_capacity_at`, `merge_reservations_admin`)** 에 들어 있어요. Race condition 안전(advisory lock).
- API는 얇은 wrapper. 인증 + 입력 검증 + RPC 호출 + 에러 매핑.

---

## 🔐 4. 인증

### 4.1 로그인 (운영 — Supabase Phone OTP)
```typescript
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(URL, ANON_KEY);

// 1) OTP 요청
await supabase.auth.signInWithOtp({ phone: "+821012345678" });

// 2) OTP 검증
const { data: { session } } = await supabase.auth.verifyOtp({
  phone: "+821012345678",
  token: "123456",
  type: "sms",
});

const accessToken = session.access_token;  // 이후 모든 API 호출에 사용
```

> ⚠️ **현재 SMS 발신 미연동** — Solapi/CoolSMS 결제 연동 후 운영 가능. 개발 중에는 아래 dev-login 사용.

### 4.2 로그인 (개발 — `/api/dev/login`)
```bash
# 주민 테스트 계정
curl -X POST http://localhost:3000/api/dev/login \
  -H "Content-Type: application/json" \
  -d '{"role":"resident"}'

# 이장님 테스트 계정
curl -X POST http://localhost:3000/api/dev/login \
  -d '{"role":"admin"}'

# → { "access_token": "eyJhbGc...", "user": {...} }
```

### 4.3 모든 API에 토큰 첨부
```typescript
fetch("/api/availability?date=2026-05-31&origin=cheongsanmyeon", {
  headers: { Authorization: `Bearer ${accessToken}` },
});
```

### 4.4 토큰 만료
Supabase access_token = 1시간. 자동 갱신은 supabase-js 클라이언트가 처리.

---

## 📡 5. API 레퍼런스

> `🔒` = 로그인 필요, `🔐` = admin 권한 필요, 표시 없음 = 공개

### 5.1 마스터 데이터 (공개)

#### `GET /api/locations`
거점 목록. 카테고리별로도 그룹핑되어 옴.
```json
{
  "locations": [
    { "id": 1, "category": "cheongsanmyeon", "name": "청산면사무소", "emoji": "🏛️", "display_order": 1 },
    ...
  ],
  "byCategory": {
    "cheongsanmyeon": [...],
    "eupnae": [...]
  }
}
```

#### `GET /api/time-slots`
시간 슬롯 목록 (09~18, 라벨 포함).
```json
{ "slots": [ { "hour": 9, "label": "오전 9시" }, ... ] }
```

#### `GET /api/health`
서버/DB 살아있는지.

---

### 5.2 인증/프로필

#### `GET /api/auth/me` 🔒
현재 사용자 + 프로필.
```json
{
  "user": { "id": "uuid", "phone": "01012345678" },
  "profile": { "id": "uuid", "name": "김주민", "role": "resident", "status": "active" },
  "needsOnboarding": false
}
```
`needsOnboarding: true` 면 가입 직후 → 프로필 입력 필요.

#### `POST /api/profile` 🔒
프로필 생성/수정. body: `{ name, phone? }`

---

### 5.3 가용성

#### `GET /api/availability?date=YYYY-MM-DD&origin={cheongsanmyeon|eupnae}` 🔒
하루 전체 시간대 잔여석.
```json
{
  "date": "2026-05-31",
  "origin": "cheongsanmyeon",
  "slots": [
    { "hour": 9,  "remaining": 4, "available": true,  "isPast": false },
    { "hour": 10, "remaining": 0, "available": false, "isPast": false },
    ...
  ]
}
```
- `remaining`: 0~4 (한 차의 합승 잔여 또는 빈 차)
- `available`: `remaining > 0 && !isPast`
- `isPast`: 오늘 날짜인데 시간이 이미 지남

#### `GET /api/availability/seats?date=...&hour=N&origin=...` 🔒
한 슬롯만 (인원 검증용).
```json
{ "date": "...", "hour": 10, "origin": "cheongsanmyeon", "remaining": 3 }
```

---

### 5.4 예약 (주민)

#### `POST /api/reservations` 🔒
신청. body:
```json
{
  "date": "2026-05-31",
  "hour": 10,
  "departure_id": 1,
  "arrival_id": 4,
  "persons": 2
}
```
응답: `{ "reservation": { id, status: "waiting", vehicle_id: 1, ... } }`

**에러 코드:**
| code | 의미 | status |
|---|---|---|
| `SAME_CATEGORY` | 출발지·도착지가 같은 지역 | 400 |
| `INVALID_PERSONS` | 1~4명 범위 벗어남 | 400 |
| `INVALID_HOUR` | 09~18 벗어남 | 400 |
| `INVALID_LOCATION` | 잘못된 location_id | 400 |
| `NO_VEHICLE` | 같은 슬롯이 다 차서 배정 불가 | 409 |

#### `GET /api/reservations/me` 🔒
내 예약 (오늘 이후, 취소 제외). `effective_status` 포함.
```json
{
  "reservations": [
    {
      "id": 12,
      "status": "waiting",          // DB 원본 상태
      "effective_status": "waiting", // 화면 표시용 (지난 슬롯 → "completed")
      "reservation_date": "2026-05-31",
      "hour": 10,
      "departure_minute": 0,
      "time_label": "오전 10시",
      "persons": 2,
      "departure": { "id": 1, "name": "청산면사무소", "category": "cheongsanmyeon" },
      "arrival": { "id": 4, "name": "옥천 농협", "category": "eupnae" },
      "vehicle": { "code": "A" } // 확정된 경우만
    }
  ]
}
```

#### `PATCH /api/reservations/{id}/cancel` 🔒
주민 본인이 자기 예약 취소. body 없음.

---

### 5.5 운행 / 통계 (주민)

#### `GET /api/runs/today` 🔒
오늘 확정 운행 목록 (per hour × vehicle × direction).
```json
{
  "date": "2026-05-30",
  "runs": [
    { "hour": 10, "time_label": "오전 10시", "origin": "cheongsanmyeon", "destination": "eupnae", "persons": 3, "seats_left": 1 }
  ]
}
```

#### `GET /api/stats/village` 🔒
마을 통계.
```json
{
  "daily": { "used": 2, "limit": 4, "remaining": 2 },
  "monthly": { "used": 18, "limit": 112, "remaining": 94, "passengers": 47, "avg_passengers_per_run": 2.6 }
}
```

---

### 5.6 이장님 (admin)

> 모두 `🔐 admin` 권한 필요. RLS + `is_admin()` 함수가 이중 체크.

#### `GET /api/admin/dashboard` 🔐
```json
{
  "date": "2026-05-30",
  "fare": 1000,
  "today": { "waiting": 0, "confirmed": 2, "cancelled": 1, "confirmed_persons": 5 },
  "pending_total": 7,  // 오늘 이후 전체 미처리 대기 — 홈 카운터용
  "limits": {
    "daily":   { "used": 2,  "limit": 4,   "remaining": 2 },
    "monthly": { "used": 18, "limit": 112, "remaining": 94 }
  }
}
```

#### `GET /api/admin/reservations?status={waiting|confirmed|cancelled}&date=YYYY-MM-DD` 🔐
관리자 예약 리스트. 신청자 프로필 + 장소명 + **이번 달 확정 탑승수** + **effective_status** + `time_label` 모두 포함.
```json
{
  "reservations": [
    {
      "id": 12,
      "status": "waiting",
      "effective_status": "waiting",
      "reservation_date": "2026-05-31",
      "hour": 10,
      "departure_minute": 30,        // 합쳐진 건은 분 단위
      "time_label": "오전 10시 30분", // 분 포함 라벨 (UI에서 그대로 써도 됨)
      "persons": 2,
      "monthly_confirmed": 3,        // 이 신청자가 이번 달 몇 번 탔는지
      "departure": { ... },
      "arrival": { ... },
      "resident": {
        "id": "uuid",
        "name": "김주민",
        "phone": "01012345678",
        "is_guest": false             // true 면 전화 신청 (📞 배지)
      },
      "vehicle": { "code": "A" }
    }
  ]
}
```

#### `POST /api/admin/reservations` 🔐 (전화 신청)
주민이 직접 신청하지 못해 이장님이 대신. body:
```json
{
  "guest_name": "박할머니",
  "guest_phone": "01099991111",
  "date": "2026-05-31",
  "hour": 10,
  "departure_id": 1,
  "arrival_id": 4,
  "persons": 2
}
```
프로필 저장 안 함 (1회성). 결과: 대기 상태로 생성.

#### `PATCH /api/admin/reservations/{id}/confirm` 🔐
확정. 일/월 한도 자동 체크.
- 성공: 200 + 알림 발송 (현재는 stub)
- 한도 초과: `DAILY_LIMIT` / `MONTHLY_LIMIT` (400)

#### `PATCH /api/admin/reservations/{id}/cancel` 🔐
취소. body: `{ "reason": "차량 사정" }`

#### `POST /api/admin/reservations/merge` 🔐 (합치기)
대기 2건 이상을 한 슬롯으로 묶고 확정.
```json
{
  "reservation_ids": [12, 13, 15],
  "new_hour": 10,
  "new_minute": 30,  // 0, 10, 20, 30, 40, 50 중 하나
  "confirmed_by": "<admin user uuid>"
}
```
**에러 코드:**
| code | 의미 |
|---|---|
| `MERGE_NEED_TWO` | 1건 이하 |
| `MERGE_NOT_ALL_WAITING` | 일부가 대기 상태가 아님 |
| `MERGE_DATE_MISMATCH` | 다른 날짜 |
| `MERGE_CATEGORY_MISMATCH` | 다른 출발 지역 |
| `MERGE_HOUR_RANGE` | 슬롯이 1시간 이상 떨어짐 |
| `MERGE_OVER_CAPACITY` | 인원 합이 4명 초과 |
| `NO_VEHICLE` | 새 슬롯에 위치 호환 차량 없음 |
| `DAILY_LIMIT` / `MONTHLY_LIMIT` | 한도 초과 |

#### `GET /api/admin/stats?date=YYYY-MM-DD` 🔐
월별 캘린더용. 날짜별 운행수 + 인원합.

---

## 🔄 6. 실시간 (Realtime)

### 6.1 패턴
```typescript
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(URL, ANON_KEY);
supabase.realtime.setAuth(accessToken);  // ← RLS 인식 필수

const channel = supabase
  .channel("reservations-changes")
  .on(
    "postgres_changes",
    { event: "*", schema: "public", table: "reservations" },
    (payload) => {
      console.log("변경 감지", payload);
      // INSERT/UPDATE/DELETE 전부 옴
      // 화면 새로고침 또는 부분 갱신
    }
  )
  .subscribe();

// 정리
channel.unsubscribe();
```

### 6.2 언제 발생?
| 동작 | 누가 신호 받음 |
|---|---|
| 주민 신청 | 이장님(대기 탭) |
| 이장님 확정 | 주민(내 예약), 이장님(대기↔확정) |
| 이장님 취소 | 주민, 이장님(확정→취소) |
| 주민 자가 취소 | 이장님 |
| 합치기 | 양쪽 모두 |

### 6.3 RLS와 권한
- 주민은 본인 예약 변경 이벤트만 받음.
- 이장님은 전체 예약 변경 이벤트 받음.
- `setAuth(token)` 호출 안 하면 변경 이벤트 0개 (RLS가 막음). **꼭 토큰 세팅 후 구독.**

---

## 📊 7. 비즈니스 규칙 (외울 것)

### 7.1 매트릭스 (차량 가용성) — 핵심
**1시간 사이클 + 위치 추적 + 빈 복귀 1시간** 모델.

| 조건 | 결과 |
|---|---|
| 같은 차·시각·같은 방향 | **합승** (4 − 인원합) |
| 같은 차·시각·다른 방향 | **마감** (0) |
| 직전 운행 도착지 = 새 출발지 (같은 방향) | 즉시 가능 (t ≥ prev_hour + 1) |
| 직전 운행 도착지 ≠ 새 출발지 (다른 방향) | **빈 복귀 1시간 필요** (t ≥ prev_hour + 2) |
| 다음 운행이 새 도착지에서 출발 안 함 | 다음 운행을 방해하면 NO_VEHICLE |

> 예) A가 9시 청산→옥천 했다면:
> - 10시 옥천→청산 ✅ (back-to-back)
> - 10시 청산→옥천 ❌ (차가 옥천에 있음)
> - 11시 청산→옥천 ✅ (10시에 빈 복귀)

### 7.2 합승 (Ride sharing)
- 같은 (날짜, 시각, 차량, 출발 지역) 묶음 = 1 런 (run)
- 정원 4명. 합승해서 8명이면 **운행 수 = 1**.
- 한도 계산은 **런 수 기준** (개별 예약 수가 아님).

### 7.3 한도
- **일**: 차량 2대 × 운행 가능 시간 = 일 최대 ~16회. 단, **정책상 일 4회 운행**으로 제한.
- **월**: 4 × 28 = **월 112회**.

### 7.4 상태 (Status)
DB의 `status` 5종:
- `waiting`: 신청만 됨, 이장님 확정 대기
- `confirmed`: 이장님 확정됨
- `cancelled`: 누가 취소함
- `completed`: 사용 안 함 (effective_status로만 계산)

**`effective_status`** (서버가 계산해서 응답에 같이 줌):
- 슬롯 시각이 이미 지났고 status가 waiting/confirmed → `"completed"`
- 그 외 → status 그대로

UI에서는 항상 `effective_status` 사용 권장.

### 7.5 알림 케이스 (현재 stub — 콘솔 로그만)
연동 시 실제 발송:
1. 이장님 확정 → **주민에게** "○월 ○일 ○시 확정"
2. 이장님 취소 → **주민에게** "○월 ○일 ○시 취소 (사유)"
3. 주민 자가 취소(대기/확정) → **주민에게** "취소되었습니다"
4. 주민이 **확정건** 취소 → **이장님에게** "○○님 취소"

---

## 🗄️ 8. DB 타입

`lib/supabase/types.ts` 전체 → 프론트에서도 그대로 import 가능 (또는 복사).

핵심:
```typescript
type LocationCategory = "cheongsanmyeon" | "eupnae";
type ReservationStatus = "waiting" | "confirmed" | "cancelled" | "completed";
type VehicleCode = "A" | "B";
```

타입 자동 생성 (Supabase가 스키마 변경됐을 때):
```bash
npx supabase gen types typescript --project-id <REF> > lib/supabase/types.ts
```

---

## 🧪 9. 테스트

### 9.1 자동 테스트 스크립트
```bash
node --env-file=.env.local scripts/test-phase4.mjs   # 기본 매트릭스
node --env-file=.env.local scripts/test-phase5.mjs   # 내 예약 / 취소
node --env-file=.env.local scripts/test-phase6.mjs   # 운행 / 통계
node --env-file=.env.local scripts/test-phase7.mjs   # 관리자
node --env-file=.env.local scripts/test-item56.mjs   # 위치 추적
```
> 모두 PASS 상태.

### 9.2 수동 체크리스트
[`docs/TEST_CHECKLIST.md`](./TEST_CHECKLIST.md) — A~K 11개 섹션. 프론트 붙이고 회귀 테스트할 때 사용.

### 9.3 테스트 콘솔
`public/dev-console.html` — 모든 백엔드 동작을 UI로 검증 가능. 단순 HTML이라 빌드 불필요. 프론트 작업 중에도 동작 비교용으로 띄워두면 좋아요.

---

## 🚀 10. 배포 (Vercel 권장)

1. https://vercel.com → GitHub 연동 → 이 저장소 Import
2. Environment Variables 등록 (위 4.1 세 가지)
3. Deploy → `https://daramjwi-taxi.vercel.app` 같은 URL
4. `git push origin main` 할 때마다 자동 재배포

> 프론트가 별도 레포면 `NEXT_PUBLIC_API_BASE_URL=https://daramjwi-taxi.vercel.app` 환경변수로 백엔드 가리키면 됨.

---

## ⚠️ 11. 현재 제약 / TODO

| 항목 | 현재 | 운영 전에 해야 함 |
|---|---|---|
| **SMS OTP 발신** | 미연동 | Solapi 또는 CoolSMS 계정 + 연동 |
| **카카오 로그인** | Supabase + 개인 카카오 앱은 KOE205 (account_email 필수) 막힘 | 카카오 비즈앱 (사업자등록증) 필요 — 일단은 SMS로만 |
| **알림톡** | stub | 카카오 비즈채널 + 알림톡 템플릿 승인 필요 |
| **공공일정 동기화** | 없음 | 사용자가 별도 요청 시 추가 |
| **운영 모니터링** | Vercel 기본 로그만 | Sentry 등 추가 권장 |

---

## 📚 12. 참고 문서

- [`docs/PROJECT_SPEC.md`](./PROJECT_SPEC.md) — 비즈니스 명세
- [`docs/HANDOFF.md`](./HANDOFF.md) — 백엔드 개발 히스토리
- [`docs/TEST_CHECKLIST.md`](./TEST_CHECKLIST.md) — 수동 검증 체크리스트
- [`docs/prototypes/admin-prototype.html`](./prototypes/admin-prototype.html) — 이장님용 UI 프로토타입
- [`docs/prototypes/resident-prototype.html`](./prototypes/resident-prototype.html) — 주민용 UI 프로토타입
- `supabase/migrations/*` — DB 스키마 + RPC 함수 (0001~0009)

---

## 💬 13. 문의

백엔드 담당: **백엔드 사장님** (this repo의 메인 커미터)
이 문서에 없는 케이스, 에러 응답 형태, 새 엔드포인트 요청 등은 Issue로 남겨주세요.

🐿️ Happy building!
