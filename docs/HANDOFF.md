# 다람쥐 택시 백엔드 — 프로젝트 핸드오프 문서

> 다른 채팅 세션에서 이 프로젝트를 이어받을 때 **이 문서 하나만** 읽으면 전체 상황을 알 수 있도록 정리한 문서.
> 함께 보세요:
> - `PROJECT_SPEC.md` — 원본 비즈니스 명세
> - `docs/API.md` — 전체 API 엔드포인트 상세 명세 (프론트 연동용)

---

## 1. 프로젝트 한 줄

충북 옥천군 청산면 마을 공동 택시(2대, 청산면↔읍내 셔틀)를 주민이 앱으로 신청하고 이장님이 확정/취소하는 시스템의 **백엔드 전용 레포**. (프론트엔드는 별도 레포 `daramjwi-taxi-client`)

- 레포: `https://github.com/Okinews-Yeonsongi/daramjwi-taxi-server`
- 사용자(=이 레포 개발자): 비전공자. 한국어 안내 우선.

## 2. 기술 스택

- **Next.js 15 (App Router) API Routes + TypeScript**
- **Supabase** (PostgreSQL + Auth + RLS + Realtime)
- 알림(SMS·카톡): **Phase 8에서 실제 발송 연결 예정** (현재는 console.log 스텁)

## 3. 실행 방법 (로컬)

```powershell
# 프로젝트 폴더: C:\Users\micha\Desktop\daramjwi-taxi-server
cd "C:\Users\micha\Desktop\daramjwi-taxi-server"
npm run dev   # 또는 npm run start (prod 빌드 후)
# 브라우저: http://localhost:3000/dev-console.html
```
- Node.js: C:\Program Files\nodejs (PATH 잡혀 있어야 함)
- 환경변수: `.env.local` (git-ignored). Supabase URL/anon/service_role + `ENABLE_DEV_LOGIN=true`.

## 4. 폴더 구조

```
app/
  api/
    auth/      (request-otp, verify-otp, me)
    profile/   (POST/PATCH)
    locations/, time-slots/
    availability/, availability/seats/
    reservations/, reservations/me/, reservations/[id]/cancel/
    runs/today/, stats/village/
    admin/
      dashboard/, profiles/, stats/, reservations/
      reservations/[id]/confirm/, reservations/[id]/cancel/
      reservations/merge/        ← 합치기
    dev/login/, dev/config/      ← 개발용 (ENABLE_DEV_LOGIN=true 일 때만)
    health/
  layout.tsx, page.tsx
lib/
  api/         (http, phone, time, admin)
  supabase/    (server, admin, anon, user, types)
  constants.ts (FARE_WON=1700, DAILY_LIMIT=4, MONTHLY_LIMIT=112)
  notify.ts    (4가지 알림 케이스 스텁)
public/
  dev-console.html   ← 현재 테스트 콘솔 (재작성 대상)
scripts/
  test-phase4~7.mjs, test-item56.mjs   (자동 테스트)
supabase/migrations/
  20260522000001 ~ 20260522000007 (7개)
middleware.ts                            (CORS)
docs/
  API.md, HANDOFF.md (이 파일)
```

## 5. DB 스키마 — 마이그레이션 7개 (모두 적용 완료)

| # | 이름 | 내용 |
|---|---|---|
| 0001 | initial_schema | profiles, vehicles, locations, time_slots, reservations + seed |
| 0002 | rls_policies | RLS + `is_admin()` (무한재귀 방지) |
| 0003 | reservation_functions | 매트릭스 알고리즘, `assign_vehicle`, `get_availability`, `create_reservation_atomic` |
| 0004 | locations_rework_remove_address | 청산 거점 4개로 재분류, profiles.address 컬럼 제거 |
| 0005 | guest_reservations | `user_id` nullable + `guest_name/phone`, `create_guest_reservation_atomic` |
| 0006 | realtime_reservations | Supabase Realtime 활성화(reservations 테이블) |
| 0007 | merge_reservations | `departure_minute` 컬럼 + `merge_reservations_admin` |

**핵심 테이블**:
- `profiles` (id=auth.users, phone, name, role: resident/admin, status)
- `reservations` (user_id? + guest_name?/guest_phone? + date, hour, departure_minute, persons, dep_loc, arr_loc, vehicle, status: waiting/confirmed/cancelled/completed)
- `locations` (category: cheongsanmyeon/eupnae, name, emoji, display_order, is_active)
- `time_slots` (hour 9-18, label)
- `vehicles` (code: A/B)

**장소** (현재 활성):
- 청산면: 청산면사무소(id=1), 백운리마을회관(2), 백운사(3), 청산고등학교(7)
- 읍내: 옥천성모병원(4), 옥천군청(5), 시장(6)

## 6. API 엔드포인트 23개 (요약 — 상세는 `docs/API.md`)

### 인증·프로필
- `POST /api/auth/request-otp` `POST /api/auth/verify-otp` — OTP 로그인 (SMS 발송 대기 중)
- `GET /api/auth/me` — 현재 사용자 + 프로필
- `POST /api/profile` — 온보딩 (name, phone) / `PATCH /api/profile`

### 마스터 데이터 (공개)
- `GET /api/locations` — `byCategory` 포함 (반대편 자동 그리기용)
- `GET /api/time-slots` — 9~18시 슬롯

### 주민용 예약 🔒
- `GET /api/availability?date=&origin=` — 시간대별 잔여/마감 (운행 후 effective_status 계산은 me 쪽)
- `GET /api/availability/seats?date=&hour=&origin=` — 인원 선택용
- `POST /api/reservations` — 예약 신청 (매트릭스+동시성 RPC)
- `GET /api/reservations/me` — 내 예약 (effective_status 포함)
- `PATCH /api/reservations/:id/cancel` — 본인 취소

### 운행·통계 (주민용 🔒)
- `GET /api/runs/today` — 오늘 운행 (차량 식별 비공개)
- `GET /api/stats/village` — `daily.used`, `monthly.{used, remaining, passengers, avg_passengers_per_run}`

### 이장님(관리자) 🔒(admin)
- `GET /api/admin/dashboard` — 오늘 요약 + 한도(운행 수 기준)
- `GET /api/admin/reservations?status=&date=` — 목록(resident.name/phone, `is_guest`, **`monthly_confirmed`**, **`effective_status`**)
- `POST /api/admin/reservations` — **전화신청(비회원 게스트 예약)**
- `PATCH /api/admin/reservations/:id/confirm` — 확정 (한도 검사, 합승은 1회)
- `PATCH /api/admin/reservations/:id/cancel` — 취소(사유 필수)
- `POST /api/admin/reservations/merge` — **합치기**(여러 대기 → 같은 차/같은 새시각+10분단위, 자동 확정)
- `GET /api/admin/profiles` — 주민 목록(확정 누적, 현재 UI에선 제거됨)
- `GET /api/admin/stats?month=YYYY-MM` — 월 통계 (`confirmed_runs`, `by_day`)

### 개발용 (`ENABLE_DEV_LOGIN=true`)
- `POST /api/dev/login` — 테스트 계정(주민/이장님) 토큰 즉시 발급
- `GET /api/dev/config` — 공개 Supabase URL/anon (콘솔의 supabase-js용)
- `GET /api/health`

## 7. 비즈니스 규칙 (반드시 강제 — 모두 백엔드 구현 완료)

1. 신청 날짜 = 오늘 포함 7일 이내
2. 신청 시간 = 현재(KST) 이후 슬롯만
3. 출발 카테고리 ≠ 도착 카테고리 (DB CHECK + 매트릭스 + API)
4. 한 운행 최대 4명, 한 신청 최대 4명 (한 운행에 들어가니까)
5. **차량 점유 4칸 규칙** (출발준비/출발/도착/운행중 = 4셀 차단)
6. **차량 자동 배정**: 합승 우선 → A 우선
7. **한도** (마을 전체, **확정된 운행 횟수 기준** — 합승은 1회):
   - 1일 4회 / 1월 112회
   - 이미 확정된 같은 운행에 합류하는 확정은 한도 미소모
8. 요금: 1,700원 (현장 결제, 앱 결제 없음)
9. 운행 시작 후 본인 취소 불가 (이장님은 가능)
10. RLS — 주민은 본인 것만, 이장님(`is_admin()`)은 전체

## 8. 알림 (현재 모두 console.log 스텁, Phase 8에서 실제 발송)

| # | 트리거 | 받는 사람 |
|---|---|---|
| 1 | 이장님 **확정** | 주민 |
| 2 | 이장님 **취소** (사유 포함) | 주민 |
| 3 | 주민 **본인 취소** (대기/확정 둘 다) | 주민 본인 (확인) |
| 4 | 주민이 **확정** 본인 취소 | 이장님 (#3과 함께 발송) |

발송 대상 phone: 회원 = profile.phone, 전화예약(게스트) = guest_phone. 시간은 hour+departure_minute(분 0 아니면 "X시 Y분"으로 포맷).

## 9. 실시간 동기화 (Realtime, migration 6)

`reservations` 테이블 Supabase Realtime 활성화. 프론트는 `supabase.channel().on('postgres_changes', ...)`로 구독.
- RLS 그대로 적용 → 이장님은 전체 변경, 주민은 본인 것만 수신
- 계산값(잔여 횟수/탑승자 수)은 이벤트 받으면 해당 GET 재호출

## 10. 현재 상태 요약

### ✅ 완료
- DB 스키마 + RLS + 7개 마이그레이션 적용 완료
- 23개 API 엔드포인트 모두 작동, 자동 테스트 통과 (Phase 4~7 + item56)
- 합치기, 전화예약(비회원), 월별 확정 횟수, 실시간 동기화, effective_status(완료 자동 분류)
- 카카오 OAuth용 백엔드 코드 자리 (Supabase 기본 제공자 사용 가정)

### ⚠️ 보류/차단
- **OTP 문자 발송**: SMS 발송업체(예: CoolSMS/Solapi) 연결 안 됨 → `/api/auth/request-otp` 호출 시 502 OTP_SEND_FAILED. 개발은 `/api/dev/login` 사용.
- **카카오 로그인**: Supabase 기본 카카오 제공자가 `account_email`을 강제 요청 → 개인(비-비즈) 앱은 KOE205. **카카오 비즈니스 채널 = 사업자등록/고유번호증 필요.**
- **카카오 알림톡**: 같은 이유로 비즈채널 필수.
- 결론: **사업자등록(또는 고유번호증) 1개 확보** 시 카카오 로그인 + 알림톡 둘 다 풀림. 그때까진 SMS 또는 dev-login으로 진행.

### 📌 사장님이 외부에서 진행할 일
1. CoolSMS/Solapi 가입 + 발신번호 등록 (SMS용; 개인 휴대폰 ARS 본인인증 가능)
2. 카카오 비즈채널 신청 (사업자등록 또는 마을 고유번호증)
3. Vercel 배포 (팀원이 API 연동 시작하려면)

## 11. 테스트 콘솔 — 새 콘솔 요구사항 (이 문서 핵심)

현재 `public/dev-console.html`는 빠르게 만든 임시 도구. **사장님이 그동안 구체적으로 정리한 요구사항을 다 담은 콘솔로 새로 만들어야 함.**

### 11.1 로그인
- ❌ 카카오 로그인 버튼은 **숨기거나 "사업자등록 후 사용 가능"으로 비활성** 표시 (개인앱이라 KOE205)
- ✅ **주민(테스트) / 이장님(테스트)** 버튼 — `POST /api/dev/login {role}` → 토큰 즉시 발급
- 로그인 후 `GET /api/auth/me`로 needsOnboarding 체크 → 첫 로그인이면 이름·전화 입력 폼(`POST /api/profile`)

### 11.2 주민용 화면 (시뮬레이션) — 다음 흐름·UI 포함
**화면 순서 (사장님 결정):** 날짜 → 출발지 → 도착지 → 시간 → 인원 → 확인 → 신청

1. **홈** — 오늘 운행(`/api/runs/today` — 오늘 날짜 자동 표시), 내 예약 진입, 마을 현황 진입
2. **날짜 선택** — 오늘 포함 7일 (자정 지나면 자동 갱신). "오늘 22일" 같은 라벨
3. **출발지 선택** — `byCategory`로 청산면/읍내 탭, 거점 카드
4. **도착지 선택** — 출발 반대 카테고리 자동 표시 (`byCategory[opposite]`)
5. **시간 선택** — `/api/availability?date=&origin=` 호출해서:
   - 마감 슬롯(`available:false`) 회색 처리
   - 지난 시간(`isPast:true`) 회색 처리
   - 오전(`hour<12`)/오후 섹션 분리
6. **인원 선택** — `/api/availability/seats?date=&hour=&origin=`의 `remaining` 으로 1~N 제한
7. **신청 확인** — 이름·날짜·시간·인원·출발/도착 표시 → `POST /api/reservations`
8. **내 예약 현황** — `/api/reservations/me` → 카드 리스트
   - `time_label` (분 있으면 "오전 10시 40분")
   - `effective_status` 배지 (대기/확정/취소/완료) — 색깔 다르게
   - 본인 취소 버튼 (`PATCH /api/reservations/:id/cancel`)
9. **마을 현황** — `/api/stats/village`로:
   - "이번 달 잔여 N회" (monthly.remaining)
   - "이번 달 탑승자 N명" (monthly.passengers)
   - "오늘 운행 N회" (daily.used)
   - "평균 탑승자 N.N명" (monthly.avg_passengers_per_run) — `.toFixed(1)` 포맷

### 11.3 이장님(관리자) 화면 (시뮬레이션) — 다음 기능 포함
- **대시보드** — 오늘 상태별 건수 + 한도 잔여(`/api/admin/dashboard`)
- **대기/확정/취소 탭** — `/api/admin/reservations?status=` 필터링
  - 각 카드에 **이름·이번달 N회·연락처·출발/도착·인원·effective_status 배지**
  - 게스트(전화예약) 표시 (📞 + `is_guest:true`)
- **확정** 버튼 → `PATCH .../confirm` → 한도 초과 시 친절한 에러
- **취소** 버튼 → 사유 prompt → `PATCH .../cancel`
- **📞 전화신청 (대리 입력)** — 이름·전화·날짜·시간·출발·도착·인원 → `POST /api/admin/reservations`
- **🔀 합치기** — 대기 카드 체크박스 (2건 이상) + 새 시각(시 select + 10분단위 분 select) → `POST /api/admin/reservations/merge`
  - 조건: 같은 날짜+같은 출발지역+시간차 ≤ 1h+인원합 ≤ 4
  - 실패 시 친절한 에러 메시지
- **월별 통계 / 일별 캘린더** — `/api/admin/stats?month=YYYY-MM` → 일주일 단위 캘린더(by_day 그리기)

### 11.4 실시간 동기화
- 콘솔이 supabase-js로 `reservations` 채널 구독
- 주민/이장님 어느 쪽 변경이든 즉시 화면 갱신 + 마을현황·대시보드 GET 재호출

### 11.5 UI/UX 가이드
- 색상 토큰 (PROJECT_SPEC 8.3): primary `#E8960A`, bg `#F4F2ED`, green `#1E8A56`, red `#CC3030`
- 큰 글씨, 큰 버튼 (어르신 사용자 대상)
- 상태 배지 색깔: 대기=회색, 확정=초록, 취소=빨강, 완료=어두운회색
- 모바일 우선 (작은 화면에서도 잘 보이게)

### 11.6 기술 메모
- 한 페이지(SPA처럼) — 라우팅은 단순 섹션 전환
- supabase-js는 CDN 모듈로 (`https://esm.sh/@supabase/supabase-js@2`)
- `/api/dev/config`로 SUPABASE_URL/anon 받아서 supabase 클라이언트 초기화 (Realtime용)
- 토큰 저장: 메모리 (페이지 새로고침 시 다시 로그인 — dev라 OK)
- 한글 깨지지 않게 `<meta charset="utf-8">`

## 12. 참고 — 자동 테스트 스크립트

`scripts/test-*.mjs` — node로 실행. 서버 켜져 있어야 함:
```
node --env-file=.env.local scripts/test-phase4.mjs
node --env-file=.env.local scripts/test-phase5.mjs
node --env-file=.env.local scripts/test-phase6.mjs
node --env-file=.env.local scripts/test-phase7.mjs
node --env-file=.env.local scripts/test-item56.mjs
```
모두 통과 상태 (Phase 4~7 = 17+20+13+19, item5/6 = 13, 합계 82개).

---

## 13. 최근 결정 요약 (구두 합의된 것들)

- **로그인 방식**: 카카오 로그인 (닉네임만) — 실제로는 사업자 필요. **개발 중엔 dev-login 사용.**
- **알림 발송 방식**: 사업자 없이 가는 동안엔 **SMS만**(Solapi 등). 사업자 확보 후 카톡 알림톡으로 교체.
- **요금/한도**: 1,700원, 일 4회/월 112회 (운행 횟수 기준, 합승 1회).
- **합치기**: 같은 날짜+같은 출발지역+시간차 ≤ 1h+인원합 ≤ 4. 10분 단위 시각.
- **장소**: 청산면 4개 거점 + 읍내 3곳 (집 주소 없음).
- **전화예약**: 이장님이 매번 이름·전화 입력 (저장 안 함, 같은 번호면 자동 집계).
- **이장님 화면에 주민 명단 페이지 폐지** → 대신 예약 목록에 `monthly_confirmed` 표시.

---

**이 문서로 새 채팅에서 바로 작업 가능합니다.** 새 채팅에게 줄 한 줄 요청 예시:

> "`docs/HANDOFF.md`의 11번(테스트 콘솔 요구사항)을 다 담은 `public/dev-console.html`을 새로 작성해줘. 모바일 우선 + 색상 토큰 적용 + supabase-js로 실시간 구독 + 모든 흐름(주민용 7단계 신청, 이장님 전화신청/합치기/한도확인 등) 포함."
