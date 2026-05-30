# 다람쥐 택시 (Darmjwi Taxi) — 프로젝트 명세서

> 이 문서는 Claude Code 등 코드 에이전트가 프로젝트를 처음부터 끝까지 개발할 수 있도록 작성된 단일 입력 문서입니다.

---

## 0. 현재 프로젝트 상황 (Claude Code가 가장 먼저 읽을 것)

이 프로젝트는 처음부터 만드는 게 아닙니다. 이미 진행 중인 상태에서 백엔드(Supabase + API)를 붙이는 작업입니다.

**현재 작업 디렉토리에 있는 것**:
- 팀원이 만든 프론트엔드 초안 (Next.js 15 + TypeScript + React)
- `PROJECT_SPEC.md` (이 파일)
- `기사님_최종본.rtf` 또는 `admin-prototype.html` — 기사님용 관리자 화면 프로토타입 (HTML/CSS)

**Claude Code가 처음에 해야 할 일 (순서대로)**:

1. **현재 폴더 구조 파악**: `package.json`, `app/` 또는 `pages/`, `components/` 등 어떤 게 있는지 확인
2. **기존 프론트 코드 분석**: 어떤 화면이 구현되어 있고 어떤 게 비어 있는지 파악
3. **명세서와 차이 보고**: 현재 코드 ↔ PROJECT_SPEC.md를 비교해서 다음을 사용자에게 알려줄 것
   - 이미 구현된 화면/기능
   - 명세서에 있지만 아직 안 만들어진 화면/기능
   - 명세서와 다르게 만들어진 부분 (예: 카테고리 명칭, 시간 슬롯 단위)
4. **기사님 프로토타입 분석**: RTF 또는 HTML 파일을 열어보고 어떤 화면이 들어있는지 파악
5. **개발 계획 제안**: 위 분석을 바탕으로 어떤 순서로 작업할지 사용자에게 제안 (Phase 1부터 무작정 시작하지 말 것)

**중요**: 사용자는 코딩 비전공자입니다. 명령어보다 한국어 안내가 우선이며, 작업 단계마다 사용자 확인을 받아가며 진행할 것.

---

## 1. 한 줄 요약

충북 옥천군 청산면 마을 공동 택시(2대 운영, 청산면↔옥천읍 셔틀)를 주민이 스마트폰 앱웹으로 신청하고, 기사님이 확정/취소하면 주민에게 SMS가 발송되는 시스템.

---

## 2. 기술 스택

| 영역 | 선택 |
|---|---|
| 앱 형태 | Next.js 15 (App Router) + PWA |
| 프론트엔드 | React + TypeScript |
| UI | Tailwind CSS + shadcn/ui |
| 백엔드 | Next.js Route Handlers / Server Actions |
| DB·인증 | Supabase (PostgreSQL + Auth + RLS) |
| SMS | NHN Cloud Notification 또는 CoolSMS |
| 배포 | Vercel (앱) + Supabase Cloud (DB) |

**인증 전략**: Supabase Auth의 익명 로그인(`signInAnonymously`)으로 세션 생성 후 `profiles` 테이블에 전화번호·이름·주소 매핑. OTP 없는 단순 가입.

---

## 3. 도메인 모델

### 3.1 핵심 개념

- **두 카테고리**: 청산면 ↔ 옥천읍("읍내"). 같은 카테고리 내 이동 불가
- **차량 2대**: A, B (주민에게는 비공개, 시스템 자동 배정)
- **시간 슬롯**: 1시간 단위, 9~18시 (10개 슬롯)
- **편도 운행 + 버퍼 = 1시간** (한 운행이 t시에 출발하면 t+1시에 도착)
- **인원**: 1회 운행 최대 4명 (합승 가능)
- **한도**: 1일 4회 / 1월 112회 (마을 전체, confirmed 기준)
- **요금**: 1,700원 (현장 결제, 앱 결제 없음)

### 3.2 장소 마스터 (초기 데이터)

| 카테고리 | 장소 | 이모지 |
|---|---|---|
| 청산면 | 우리집 | 🏠 |
| 청산면 | 마을회관 | 🏛 |
| 청산면 | 청산면사무소 | 🏢 |
| 읍내 (옥천읍) | 옥천성모병원 | 🏥 |
| 읍내 | 옥천군청 | 🏛 |
| 읍내 | 시장 | 🛒 |

### 3.3 예약 상태

```
[waiting] ──기사님 확정──> [confirmed] ──운행시간 도래──> [completed]
    │                          │
    ├──본인/기사님 취소──> [cancelled]
    └──본인/기사님 취소──> [cancelled]
```

상태 전이 시 부수효과:

| 전이 | 일·월 한도 | 확정 횟수 | SMS |
|---|---|---|---|
| waiting → confirmed | -1 | +1 | 주민에게 |
| waiting → cancelled (기사님) | - | - | 주민에게 (사유 포함) |
| waiting → cancelled (본인) | - | - | 없음 |
| confirmed → cancelled (기사님) | +1 | -1 | 주민에게 (사유 포함) |
| confirmed → cancelled (본인) | +1 | -1 | 기사님에게 |
| confirmed → completed (자동) | - | - | 없음 |

---

## 4. 핵심 알고리즘: 차량 점유 매트릭스

### 4.1 매트릭스 구조

특정 날짜에 대해 4×10 매트릭스 동적 계산:

| 행 | 9 | 10 | ... | 18 |
|---|---|---|---|---|
| 청산면-A | 0/1 | 0/1 | | 0/1 |
| 청산면-B | 0/1 | 0/1 | | 0/1 |
| 읍내-A | 0/1 | 0/1 | | 0/1 |
| 읍내-B | 0/1 | 0/1 | | 0/1 |

`{출발지}-{차량}` 행의 `t시` 칸: 0=가능, 1=불가.

### 4.2 점유 규칙 (한 예약이 막는 4칸)

예약 `(출발 X → 도착 Y, t시, 차량 V)`가 막는 칸:

```
(X, V, t-1)  ← 출발 준비
(X, V, t)    ← 실제 출발
(X, V, t+1)  ← V는 Y에 있음
(Y, V, t)    ← V는 운행 중
```

### 4.3 의사코드

```typescript
function getBlockedCells(reservation: Reservation): Cell[] {
  const { departure_category: X, arrival_category: Y, hour: t, vehicle: V } = reservation;
  return [
    { origin: X, vehicle: V, hour: t - 1 },
    { origin: X, vehicle: V, hour: t },
    { origin: X, vehicle: V, hour: t + 1 },
    { origin: Y, vehicle: V, hour: t },
  ].filter(c => c.hour >= 9 && c.hour <= 18);
}

function buildMatrix(date: Date): Matrix {
  const matrix = createEmptyMatrix(); // 4x10, all 0
  const reservations = await db.reservations.findMany({
    where: { date, status: { in: ['waiting', 'confirmed'] } }
  });
  for (const r of reservations) {
    for (const cell of getBlockedCells(r)) {
      matrix[cell.origin][cell.vehicle][cell.hour] = 1;
    }
  }
  return matrix;
}

function assignVehicle(
  matrix: Matrix, 
  date: Date, 
  hour: number, 
  origin: Category, 
  persons: number
): 'A' | 'B' | null {
  // 우선순위 1: 합승 가능한 기존 운행
  for (const V of ['A', 'B']) {
    if (matrix[origin][V][hour] === 0) {
      const existingRun = await findRun(date, hour, origin, V);
      if (existingRun && existingRun.passenger_count + persons <= 4) {
        return V;
      }
    }
  }
  // 우선순위 2: 빈 차량 (A 먼저)
  for (const V of ['A', 'B']) {
    if (matrix[origin][V][hour] === 0) {
      const existingRun = await findRun(date, hour, origin, V);
      if (!existingRun) return V;
    }
  }
  return null; // 마감
}
```

### 4.4 신청 가능 검증

신청 시 모든 조건을 통과해야 함:

```typescript
async function canBook(input: BookingInput): Promise<Result> {
  // 1. 날짜 범위 (오늘 포함 7일)
  const daysFromToday = differenceInDays(input.date, today());
  if (daysFromToday < 0 || daysFromToday > 6) return error('날짜 범위 벗어남');

  // 2. 시간 미래 (현재 시점 기준)
  const slotStart = combineDateTime(input.date, input.hour);
  if (slotStart <= now()) return error('이미 지난 시간');

  // 3. 출발지 ≠ 도착지 카테고리
  if (input.departure.category === input.arrival.category) return error('같은 지역 이동 불가');

  // 4. 인원 범위
  if (input.persons < 1 || input.persons > 4) return error('인원 1~4명');

  // 5. 차량 배정 가능 여부 (트랜잭션 내에서 재확인)
  // 6. 인원 ≤ 잔여 좌석
  return success();
}
```

---

## 5. 데이터베이스 스키마

### 5.1 ERD 요약

```
auth.users (Supabase Auth)
   │ 1:1
profiles (앱 사용자 프로필)
   │ 1:N
reservations (예약) ─── locations (장소 마스터)
   │              \─── time_slots (시간 슬롯 마스터)
   │              \─── vehicles (차량 마스터)
```

### 5.2 DDL

```sql
-- 1. 프로필
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(50) NOT NULL,
  address TEXT,
  role VARCHAR(20) NOT NULL DEFAULT 'resident' CHECK (role IN ('resident', 'admin')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_profiles_phone ON profiles(phone);
CREATE INDEX idx_profiles_role ON profiles(role);

-- 2. 차량
CREATE TABLE vehicles (
  id SERIAL PRIMARY KEY,
  code VARCHAR(2) NOT NULL UNIQUE CHECK (code IN ('A', 'B')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO vehicles (code) VALUES ('A'), ('B');

-- 3. 장소
CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  category VARCHAR(20) NOT NULL CHECK (category IN ('cheongsanmyeon', 'eupnae')),
  name VARCHAR(50) NOT NULL,
  emoji VARCHAR(8),
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_locations_category ON locations(category, display_order);
INSERT INTO locations (category, name, emoji, display_order) VALUES
  ('cheongsanmyeon', '우리집', '🏠', 1),
  ('cheongsanmyeon', '마을회관', '🏛', 2),
  ('cheongsanmyeon', '청산면사무소', '🏢', 3),
  ('eupnae', '옥천성모병원', '🏥', 1),
  ('eupnae', '옥천군청', '🏛', 2),
  ('eupnae', '시장', '🛒', 3);

-- 4. 시간 슬롯
CREATE TABLE time_slots (
  hour INT PRIMARY KEY CHECK (hour BETWEEN 9 AND 18),
  label VARCHAR(20) NOT NULL
);
INSERT INTO time_slots (hour, label) VALUES
  (9, '오전 9시'), (10, '오전 10시'), (11, '오전 11시'),
  (12, '오후 12시'), (13, '오후 1시'), (14, '오후 2시'),
  (15, '오후 3시'), (16, '오후 4시'), (17, '오후 5시'), (18, '오후 6시');

-- 5. 예약
CREATE TABLE reservations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reservation_date DATE NOT NULL,
  hour INT NOT NULL REFERENCES time_slots(hour),
  persons INT NOT NULL CHECK (persons BETWEEN 1 AND 4),
  departure_location_id INT NOT NULL REFERENCES locations(id),
  arrival_location_id INT NOT NULL REFERENCES locations(id),
  vehicle_id INT REFERENCES vehicles(id),
  status VARCHAR(20) NOT NULL DEFAULT 'waiting' 
    CHECK (status IN ('waiting', 'confirmed', 'cancelled', 'completed')),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES profiles(id),
  cancel_reason TEXT,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (departure_location_id <> arrival_location_id)
);
CREATE INDEX idx_reservations_user ON reservations(user_id, created_at DESC);
CREATE INDEX idx_reservations_date_active 
  ON reservations(reservation_date, hour) 
  WHERE status IN ('waiting', 'confirmed');
CREATE INDEX idx_reservations_status ON reservations(status);

-- 6. 매트릭스 계산 헬퍼 뷰 (옵션)
CREATE OR REPLACE VIEW v_active_reservations AS
SELECT 
  r.id, r.reservation_date, r.hour, r.vehicle_id, r.persons,
  dep.category AS departure_category,
  arr.category AS arrival_category,
  v.code AS vehicle_code
FROM reservations r
JOIN locations dep ON dep.id = r.departure_location_id
JOIN locations arr ON arr.id = r.arrival_location_id
JOIN vehicles v ON v.id = r.vehicle_id
WHERE r.status IN ('waiting', 'confirmed');
```

### 5.3 RLS 정책

```sql
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;
-- locations, time_slots, vehicles는 마스터 데이터라 모두 SELECT 허용, 변경은 service_role만

-- profiles: 본인만 조회/수정, admin은 전체
CREATE POLICY "users see own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "admin sees all profiles" ON profiles FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "users update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "users insert own profile" ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- reservations: 본인만 조회, admin은 전체
CREATE POLICY "users see own reservations" ON reservations FOR SELECT 
  USING (auth.uid() = user_id);
CREATE POLICY "admin sees all reservations" ON reservations FOR SELECT 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
CREATE POLICY "users create own reservations" ON reservations FOR INSERT 
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own reservations" ON reservations FOR UPDATE 
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admin updates all reservations" ON reservations FOR UPDATE 
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'));
```

---

## 6. 동시성 처리

신청 트랜잭션은 PostgreSQL의 `SELECT ... FOR UPDATE` 활용:

```typescript
// Server Action 또는 API Route 핸들러
async function createReservation(input: BookingInput, userId: string) {
  return await supabase.rpc('create_reservation_atomic', {
    p_user_id: userId,
    p_date: input.date,
    p_hour: input.hour,
    p_departure_id: input.departure_id,
    p_arrival_id: input.arrival_id,
    p_persons: input.persons,
  });
}
```

```sql
-- PostgreSQL 함수로 원자성 보장
CREATE OR REPLACE FUNCTION create_reservation_atomic(
  p_user_id UUID,
  p_date DATE,
  p_hour INT,
  p_departure_id INT,
  p_arrival_id INT,
  p_persons INT
) RETURNS reservations AS $$
DECLARE
  v_departure_cat VARCHAR;
  v_arrival_cat VARCHAR;
  v_vehicle_id INT;
  v_existing_count INT;
  v_new_reservation reservations;
BEGIN
  -- 날짜 잠금 (해당 날짜의 모든 예약을 잠가서 다른 트랜잭션 대기)
  PERFORM 1 FROM reservations 
    WHERE reservation_date = p_date AND status IN ('waiting', 'confirmed')
    FOR UPDATE;

  -- 카테고리 검증
  SELECT category INTO v_departure_cat FROM locations WHERE id = p_departure_id;
  SELECT category INTO v_arrival_cat FROM locations WHERE id = p_arrival_id;
  IF v_departure_cat = v_arrival_cat THEN
    RAISE EXCEPTION '같은 지역 내 이동은 불가능합니다';
  END IF;

  -- 매트릭스 계산 + 차량 배정 (Postgres 함수로 분리 구현)
  v_vehicle_id := assign_vehicle(p_date, p_hour, v_departure_cat, p_persons);
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION '방금 다른 분이 예약하셨어요. 다시 선택해 주세요';
  END IF;

  -- INSERT
  INSERT INTO reservations 
    (user_id, reservation_date, hour, persons, 
     departure_location_id, arrival_location_id, vehicle_id, status)
  VALUES 
    (p_user_id, p_date, p_hour, p_persons, 
     p_departure_id, p_arrival_id, v_vehicle_id, 'waiting')
  RETURNING * INTO v_new_reservation;

  RETURN v_new_reservation;
END;
$$ LANGUAGE plpgsql;
```

`assign_vehicle` 함수도 4.3 알고리즘에 맞춰 PL/pgSQL로 구현 (구현은 Claude Code가 작성).

---

## 7. API 엔드포인트

### 7.1 인증·프로필

| 메서드 | 경로 | 설명 |
|---|---|---|
| POST | `/api/auth/sign-up` | 익명 로그인 + profiles 생성 (이름·연락처·주소) |
| GET | `/api/auth/me` | 현재 사용자 정보 |
| PATCH | `/api/profile` | 프로필 수정 |

### 7.2 마스터 데이터

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/locations` | 장소 목록 |
| GET | `/api/time-slots` | 시간 슬롯 목록 |

### 7.3 예약 (주민용)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/availability?date=YYYY-MM-DD&origin=cheongsanmyeon` | 그 날짜+출발 카테고리의 시간별 활성/마감 |
| GET | `/api/availability/seats?date=YYYY-MM-DD&hour=10&origin=cheongsanmyeon` | 인원 단계용 잔여석 |
| POST | `/api/reservations` | 신청 (위 동시성 RPC 호출) |
| GET | `/api/reservations/me` | 내 예약 (7일 이내, cancelled 제외) |
| PATCH | `/api/reservations/:id/cancel` | 본인 취소 |

### 7.4 운행·통계 (주민용)

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/runs/today` | 오늘 전체 운행 일정 |
| GET | `/api/stats/village` | 마을 현황 (월 누적, 오늘 누적, 잔여 한도, 요금) |

### 7.5 관리자용

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/admin/dashboard` | 오늘 요약 |
| GET | `/api/admin/reservations?status=waiting` | 예약 필터 조회 |
| PATCH | `/api/admin/reservations/:id/confirm` | 확정 → SMS 발송 |
| PATCH | `/api/admin/reservations/:id/cancel` | 취소 (사유 필수) → SMS 발송 |
| GET | `/api/admin/profiles` | 주민 목록 + 확정 횟수 |
| GET | `/api/admin/stats?month=YYYY-MM` | 통계 |

---

## 8. 화면 명세

### 8.1 주민용 화면 (프로토타입 image 0~8 기반)

| 화면 | 경로 | 핵심 컴포넌트 |
|---|---|---|
| 온보딩 | `/onboarding` | OnboardingForm |
| 홈 | `/` | HomeGreeting, MenuCard ×4 |
| 신청 1: 날짜 | `/booking/date` | StepBar, DateList (7일) |
| 신청 2: 시간 | `/booking/time` | StepBar, TimeGrid (오전/오후 섹션) |
| 신청 3: 인원 | `/booking/persons` | StepBar, PersonGrid (1~4명) |
| 신청 4: 출발지 | `/booking/departure` | StepBar, CategoryTabs, LocationList |
| 신청 5: 도착지 | `/booking/arrival` | StepBar, LocationList (반대편 자동) |
| 확인 모달 | (모달) | ConfirmModal |
| 완료 | `/booking/complete` | SuccessScreen |
| 오늘 운행 | `/runs/today` | RunList |
| 마을 현황 | `/village` | StatsCards |
| 내 예약 현황 | `/my-reservations` | ReservationCard list |

### 8.2 관리자용 화면

| 화면 | 경로 |
|---|---|
| 대시보드 | `/admin` |
| 예약 관리 | `/admin/reservations` |
| 주민 관리 | `/admin/profiles` |
| 운행 현황 (매트릭스 시각화) | `/admin/runs` |
| 통계 | `/admin/stats` |

### 8.3 디자인 토큰

```css
--primary: #E8960A;
--primary-light: #FEF3DC;
--primary-dark: #B87208;
--bg: #F4F2ED;
--card: #FFFFFF;
--text: #111008;
--text-muted: #666;
--green: #1E8A56;
--green-light: #DDF4EA;
--red: #CC3030;
--red-light: #FDEAEA;
--radius-sm: 14px;
--radius: 20px;
--radius-lg: 26px;
```

- 본문 16~18px, 버튼 20~22px / 800 weight
- 큰 숫자(날짜·인원) 40~56px / 900 weight
- 모든 버튼 최소 56px 높이
- 카드 모서리 20px+, 부드러운 그림자
- 선택 상태: 황금 테두리 + 옅은 노랑 배경 + ✓ 체크 3중 표현

### 8.4 카피 톤

- "예약" = 저장된 레코드 / "탑승 신청" = 신청 행위
- 모든 질문은 의문형: "언제 탑승하실 건가요?"
- 명령은 부드럽게: "선택해주세요"
- 카테고리 명칭: 항상 "청산면" / "읍내"
- 에러는 한글 친근체: "방금 다른 분이 예약하셨어요"

---

## 9. SMS 발송

### 9.1 트리거

| 전이 | 수신자 |
|---|---|
| 기사님 확정 | 주민 |
| 기사님 취소 | 주민 (사유 포함) |
| 주민이 confirmed 취소 | 기사님 |

### 9.2 템플릿

```
[다람쥐택시] {이름}님, {월}월 {일}일({요일}) {시간} 탑승 예약이 확정되었어요.
출발: {출발지명}, 도착: {도착지명}.

[다람쥐택시] {이름}님, {월}월 {일}일({요일}) {시간} 탑승 예약이 취소되었어요.
사유: {사유}.

[다람쥐택시] 기사님, {이름}님이 {월}월 {일}일({요일}) {시간} 예약을 취소했어요.
노선: {출발}→{도착}, 인원: {N}명.
```

### 9.3 구현

- Supabase Edge Function `send-sms` 작성
- 확정/취소 API 핸들러에서 비동기 호출 (실패해도 본 트랜잭션 영향 없도록)
- 환경변수 `SMS_API_KEY`, `SMS_SENDER_NUMBER`

---

## 10. PWA 설정

```json
// public/manifest.json
{
  "name": "다람쥐 택시",
  "short_name": "다람쥐택시",
  "description": "우리 마을 이동 도우미",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#F4F2ED",
  "theme_color": "#E8960A",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Service Worker는 `next-pwa` 라이브러리 사용. 오프라인 캐싱은 정적 자원만, 데이터는 항상 네트워크 우선.

---

## 11. 환경변수

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SMS_API_KEY=
SMS_API_SECRET=
SMS_SENDER_NUMBER=
```

---

## 12. 개발 순서 (권장)

```
Phase 1. 프로젝트 셋업
  ├─ npx create-next-app@latest with TypeScript, Tailwind
  ├─ shadcn/ui 초기화
  ├─ Supabase 프로젝트 생성, .env 설정
  └─ DDL 마이그레이션 (5.2)

Phase 2. 인증·온보딩
  ├─ Supabase Auth 익명 로그인 통합
  ├─ /onboarding 화면 + sign-up API
  └─ 자동 로그인 (세션 복원)

Phase 3. 마스터 데이터 + 홈
  ├─ /api/locations, /api/time-slots
  └─ 홈 화면 (인사말, 4개 메뉴 카드)

Phase 4. 신청 흐름 (핵심)
  ├─ 5단계 화면 + StepBar
  ├─ /api/availability (매트릭스 알고리즘 구현)
  ├─ /api/availability/seats
  ├─ create_reservation_atomic SQL 함수
  └─ /api/reservations POST + 완료 화면

Phase 5. 내 예약 + 취소
  ├─ /api/reservations/me
  ├─ 내 예약 현황 화면
  └─ 취소 액션 (본인, 운행 전까지)

Phase 6. 부가 화면
  ├─ 오늘 운행 (/api/runs/today)
  └─ 마을 현황 (/api/stats/village)

Phase 7. 기사님용
  ├─ /admin 라우트 가드 (role 검증)
  ├─ 대시보드
  ├─ 예약 관리 + 확정/취소 액션
  └─ 주민 관리 + 통계

Phase 8. SMS 연동
  ├─ Edge Function send-sms
  └─ 확정/취소 트리거 연결

Phase 9. PWA + 마무리
  ├─ manifest, 아이콘
  ├─ next-pwa 설정
  └─ QA 시나리오 점검
```

---

## 13. 주요 비즈니스 규칙 (반드시 강제)

1. 신청 날짜는 오늘 포함 7일 이내 (오늘이 22일이면 22~28일)
2. 신청 시간은 현재 시각보다 미래 (오후 2시면 같은 날 1시·2시 슬롯 불가)
3. 출발지·도착지는 서로 다른 카테고리
4. 한 운행 최대 4명 (합승은 같은 시간+같은 방향만)
5. 차량 점유 매트릭스의 4칸 규칙 (4.2) 엄격 준수
6. 일 한도 4회, 월 한도 112회 (confirmed 기준)
7. 차량 자동 배정: 합승 우선, 그다음 A 우선
8. 모든 신청은 waiting 상태로 시작, 기사님 확정 필요
9. 운행 시작 시각 이후 취소 불가
10. RLS로 주민은 본인 예약만 조회/수정 가능
