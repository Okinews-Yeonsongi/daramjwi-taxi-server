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

## 🔐 4. 인증 — 카카오 OAuth (메인) + 자동 로그인 유지

### 4.1 로그인 흐름 (운영)
**카카오 로그인 (닉네임/프사만) + 전화번호 1회 입력**. 사업자등록 없이 동작.

```
[사용자]                                  [프론트]                              [백엔드]
   │  '카카오로 시작하기' 클릭                │                                      │
   ├────────────────────────────────────►│                                      │
   │                                      │  GET /api/auth/kakao/start?next=/  │
   │                                      ├────────────────────────────────────►│
   │  ◄── 302 redirect to kakao.com ───────────────────────────────────────────│
   │                                                                            │
   │  카카오 로그인 + 동의 (닉네임/프사)                                          │
   │  ◄── 302 redirect to /api/auth/kakao/callback?code=... ──────────────────│
   │                                                                            │
   │                                      │  GET /api/auth/kakao/callback       │
   │                                      ├────────────────────────────────────►│
   │                                      │                                    │ Kakao API로 code→token→user info
   │                                      │                                    │ profiles에 kakao_id로 매칭/생성
   │                                      │                                    │ Supabase 세션 토큰 발급
   │                                      │  ◄── 302 redirect to /#access_token=...&refresh_token=...&needsOnboarding=1
   │                                      │                                      │
   │                                      │  fragment에서 토큰 추출 → 저장        │
   │                                      │  needsOnboarding=1이면 온보딩 화면   │
```

### 4.2 프론트 구현 (한 줄)
사용자가 "카카오로 시작하기" 버튼 클릭 시:
```typescript
function loginWithKakao() {
  // next는 콜백 후 돌아올 경로 (이 페이지 그대로 또는 홈)
  const next = encodeURIComponent(location.pathname);
  location.href = `${API_BASE}/api/auth/kakao/start?next=${next}`;
}
```

### 4.3 콜백 처리 + 토큰 저장 (자동 로그인 핵심)
페이지 로드 시 URL fragment 검사:
```typescript
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

window.addEventListener("DOMContentLoaded", async () => {
  // 1) 카카오 콜백에서 돌아온 경우 — fragment에 토큰 있음
  const frag = new URLSearchParams((location.hash || "").slice(1));
  const access_token = frag.get("access_token");
  const refresh_token = frag.get("refresh_token");
  const needsOnboarding = frag.get("needsOnboarding") === "1";

  if (access_token && refresh_token) {
    // 영구 저장
    localStorage.setItem("sb-access", access_token);
    localStorage.setItem("sb-refresh", refresh_token);
    history.replaceState(null, "", location.pathname); // URL 정리
    await supabase.auth.setSession({ access_token, refresh_token });
    if (needsOnboarding) showOnboarding(); else goHome();
    return;
  }

  // 2) 이전에 저장된 토큰이 있으면 자동 로그인 복원
  const savedAccess = localStorage.getItem("sb-access");
  const savedRefresh = localStorage.getItem("sb-refresh");
  if (savedAccess && savedRefresh) {
    const { error } = await supabase.auth.setSession({
      access_token: savedAccess,
      refresh_token: savedRefresh,
    });
    if (!error) {
      // 자동 로그인 성공! supabase-js가 만료된 access_token도 refresh로 자동 갱신
      goHome();
      return;
    }
    // refresh token도 만료된 경우 → 카카오 다시
    localStorage.removeItem("sb-access");
    localStorage.removeItem("sb-refresh");
  }

  // 3) 어느 것도 아니면 로그인 화면
  showLogin();
});
```

**결과 — 어르신 시나리오:**
- 5/31: 카카오로 시작 → 전화번호 입력 → 가입 완료
- 6월~12월: 앱 열 때마다 자동 로그인 (액세스 토큰은 백그라운드에서 갱신)
- 카카오 다시 누를 일 거의 없음 (refresh token이 무한 갱신 가능)

### 4.4 API 호출 (Bearer 토큰)
```typescript
async function api(path: string, opts: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  return fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      ...opts.headers,
      Authorization: `Bearer ${session?.access_token}`,
      "Content-Type": "application/json",
    },
  });
}
```
> supabase-js가 만료된 토큰을 자동으로 갱신하므로 항상 `getSession()`으로 최신 토큰 가져오세요.

### 4.5 온보딩 (전화번호 입력) — 첫 카카오 가입자만
- `/api/auth/me` 응답의 `needsOnboarding: true` 이거나 콜백에서 `needsOnboarding=1` fragment 받으면 표시
- 화면: 이름(카카오 닉네임 자동 채움, 수정 가능) + 전화번호 입력
- 제출: `POST /api/profile` with `{ name, phone }`
- 성공하면 홈으로
- 두 번째 이후 로그인부터는 자동으로 홈 (온보딩 안 뜸)

### 4.6 로그아웃
```typescript
async function logout() {
  await supabase.auth.signOut();
  localStorage.removeItem("sb-access");
  localStorage.removeItem("sb-refresh");
  // 카카오 자체에서도 로그아웃 원하면:
  // location.href = `https://kauth.kakao.com/oauth/logout?client_id=...&logout_redirect_uri=...`
  showLogin();
}
```

### 4.7 개발용 로그인 (`/api/dev/login`) — 로그인 화면 만들기 전까지 임시 사용
```typescript
const { access_token, user } = await fetch(`${API_BASE}/api/dev/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ role: "resident" }),  // 또는 "admin"
}).then(r => r.json());
```
> 운영 오픈 전 Vercel 환경변수 `ENABLE_DEV_LOGIN=true` 반드시 제거.

### 4.8 토큰 수명 한눈에
| 토큰 | 수명 | 갱신 |
|---|---|---|
| `access_token` | 1시간 | refresh_token으로 자동 갱신 |
| `refresh_token` | 30일 (Supabase 기본) | 사용 시마다 갱신 (rolling) — 30일 이내 다시 들어오면 무한 |
| 카카오 동의 | 영구 | 사용자가 카카오 설정에서 해지하지 않는 한 |

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

### 5.6 기사님 (admin)

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

#### `GET /api/admin/reservations?status={waiting|confirmed|cancelled}&date=YYYY-MM-DD&include_past=1` 🔐
> **기본: 오늘 이후 예약만 반환** (`reservation_date >= today`). 과거 데이터는 처리 불가능해서 노이즈. 통계·캘린더용으로 과거까지 보려면 `?include_past=1` 또는 `?date=YYYY-MM-DD` 지정.
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
주민이 직접 신청하지 못해 기사님이 대신. body:
```json
{
  "name": "박할머니",
  "phone": "01099991111",
  "date": "2026-05-31",
  "hour": 10,
  "departure_id": 1,
  "arrival_id": 4,
  "persons": 2
}
```
**자동 회원 매칭 (0012):** 입력한 `phone`과 동일한 회원이 있으면 → 그 user_id로 회원 예약 저장 → 본인 "내 예약"에 자동 표시.  매칭 없으면 → guest 예약 (user_id=NULL).

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
| 주민 신청 | 기사님(대기 탭) |
| 기사님 확정 | 주민(내 예약), 기사님(대기↔확정) |
| 기사님 취소 | 주민, 기사님(확정→취소) |
| 주민 자가 취소 | 기사님 |
| 합치기 | 양쪽 모두 |

### 6.3 RLS와 권한
- 주민은 본인 예약 변경 이벤트만 받음.
- 기사님은 전체 예약 변경 이벤트 받음.
- `setAuth(token)` 호출 안 하면 변경 이벤트 0개 (RLS가 막음). **꼭 토큰 세팅 후 구독.**

---

## 🔔 6.5 알림 — 웹 푸시 (사업자 X, 0원)

### 6.5.1 알림 종류 4가지 — 백엔드가 자동 발송
| 트리거 | 누가 → 누구에게 | 푸시 내용 |
|---|---|---|
| 기사님 확정 | 기사님 → 주민 | "✅ 예약 확정 — {날짜 시간} · {출발}→{도착}" |
| 기사님 취소 | 기사님 → 주민 | "❌ 예약 취소 — {날짜 시간} · 사유: {사유}" |
| 주민 본인 취소 (대기/확정) | 주민 → 본인에게 | "🗑️ 취소 완료" |
| 주민이 **확정건** 취소 | 주민 → 기사님 전원 | "⚠️ 확정 예약 취소 — {이름} · {시간}" |

> 전화신청(guest, `is_guest=true`) 건은 사용자 계정이 없어 푸시 대상 X. 기사님이 전화로 안내.

### 6.5.2 프론트가 해야 할 일 — Service Worker + 구독 등록

#### a) `public/sw.js` 배치 (서비스 워커, 푸시 수신용)
이미 작성됨 ([`public/sw.js`](../public/sw.js)). 프론트 앱에서도 같은 파일 또는 더 발전된 형태로 배치하면 됨. 최소 사양:
```javascript
self.addEventListener('push', (event) => {
  const payload = event.data?.json() || {};
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    tag: payload.tag,
    data: { url: payload.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(self.clients.openWindow(url));
});
```

#### b) 로그인 후 구독 등록 (사용자 클릭 안에서 권한 요청!)
```typescript
async function enablePushNotifications() {
  // iOS Safari는 PWA(홈화면 추가) 모드만 푸시 가능
  if (isIOS() && !isInStandalone()) {
    showIosInstallGuide();
    return;
  }

  const reg = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;

  // 권한 요청은 반드시 사용자 클릭 핸들러 안에서!
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return;

  // VAPID 공개키 받아서 푸시 구독
  const { publicKey } = await fetch(`${API_BASE}/api/push/public-key`).then(r => r.json());
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  // 백엔드에 구독 저장 (이후 백엔드가 이 endpoint로 푸시 보냄)
  await api("/api/push/subscribe", {
    method: "POST",
    body: JSON.stringify({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.toJSON().keys.p256dh, auth: sub.toJSON().keys.auth },
      user_agent: navigator.userAgent.slice(0, 200),
    }),
  });
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - base64.length % 4) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
```

### 6.5.3 iOS Safari 특수 — 홈 화면 추가 필수
- iOS는 **iOS 16.4+ + 홈 화면 추가(PWA 모드)** 에서만 웹 푸시 동작
- 일반 Safari 탭에서는 `Notification.requestPermission()` 무시됨
- 사용자에게 안내 필요:
  > 📱 알림을 받으려면 **공유 버튼 → "홈 화면에 추가"** 후 그 아이콘으로 실행해주세요.

PWA 매니페스트는 [`public/manifest.json`](../public/manifest.json)에 있음. 프론트도 비슷한 manifest 작성 + apple-touch-icon 메타 추가.

### 6.5.4 푸시 관련 API
| 엔드포인트 | 메소드 | 설명 |
|---|---|---|
| `/api/push/public-key` | GET | VAPID 공개키 받기 (공개, 인증 X) |
| `/api/push/subscribe` | POST 🔒 | 푸시 구독 정보 저장 |
| `/api/push/subscribe?endpoint=...` | DELETE 🔒 | 구독 해지 |

### 6.5.5 사업자등록 후 확장 (선택)
사장님이 사업자등록증 받으면:
- 솔라피 (Solapi) 연동 → 푸시 + SMS 동시 발송 (`lib/notify.ts`에 추가만 하면 됨)
- 카카오 알림톡 (비즈채널 + 템플릿 심사 후) → 더 풍부한 메시지
- 백엔드 코드 변경만 필요, 프론트는 변경 없음 (호출하는 API 동일)

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

### 7.3 한도 (매트릭스에 반영됨 — 0011)
- **일**: 정책상 일 4회 운행 제한
- **월**: 4 × 28 = 월 112회
- **한도 도달 시 동작:**
  - 빈 차량으로 새 운행 시도 → 매트릭스에 **마감** 표시 (잔여 0)
  - **합승은 허용** — 기존 운행에 인원만 추가하는 거라 운행 수 안 늘림
  - 예: 4회 운행 다 차도 어느 시간 차 A에 2명만 있으면 → 그 시간 합승 잔여 2명 표시

### 7.3.1 전화 신청 자동 회원 매칭 (0012)
- 기사님이 📞 전화 신청 6단계로 입력 시:
  - 입력된 **전화번호로 `profiles` 검색** → 같은 phone의 회원 있으면 → 그 user_id로 회원 예약 저장
  - 매칭 안 되면 → 기존대로 guest 예약 (user_id=NULL)
- **결과:**
  - 카카오 가입 어르신 → 본인 "내 예약"에 자동 표시 ✅
  - 미가입 어르신 → guest 예약, "내 예약"에 안 보임 (정상)
- 프론트는 알아서 해줄 일 없음 — 백엔드가 자동 처리

### 7.4 상태 (Status)
DB의 `status` 5종:
- `waiting`: 신청만 됨, 기사님 확정 대기
- `confirmed`: 기사님 확정됨
- `cancelled`: 누가 취소함
- `completed`: 사용 안 함 (effective_status로만 계산)

**`effective_status`** (서버가 계산해서 응답에 같이 줌):
- 슬롯 시각이 이미 지났고 status가 waiting/confirmed → `"completed"`
- 그 외 → status 그대로

UI에서는 항상 `effective_status` 사용 권장.

### 7.5 알림 케이스 (현재 stub — 콘솔 로그만)
연동 시 실제 발송:
1. 기사님 확정 → **주민에게** "○월 ○일 ○시 확정"
2. 기사님 취소 → **주민에게** "○월 ○일 ○시 취소 (사유)"
3. 주민 자가 취소(대기/확정) → **주민에게** "취소되었습니다"
4. 주민이 **확정건** 취소 → **기사님에게** "○○님 취소"

---

## 🗄️ 8. DB 타입

`lib/supabase/types.ts` 전체 → 프론트에서도 그대로 import 가능 (또는 복사).

### 8.1 핵심 enum
```typescript
type LocationCategory = "cheongsanmyeon" | "eupnae";
type ReservationStatus = "waiting" | "confirmed" | "cancelled" | "completed";
type VehicleCode = "A" | "B";
```

### 8.2 주요 테이블
- **profiles** — 사용자 (id, phone, name, role, status, kakao_id, kakao_nickname, kakao_profile_image)
- **reservations** — 예약 (id, user_id, guest_name, guest_phone, date, hour, departure_minute, persons, status, vehicle_id, ...)
- **locations** — 거점 (id, category, name, emoji, display_order)
- **vehicles** — 차량 (id, code, is_active)
- **time_slots** — 시간 슬롯 (hour, label)
- **push_subscriptions** — 웹 푸시 구독 (id, user_id, endpoint, p256dh, auth, user_agent) — 0010에서 추가

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

### 10.1 백엔드 배포 (이미 끝남)
- URL: `https://daramjwi-taxi-server.vercel.app`
- 매번 `git push origin main` 할 때마다 자동 재배포

### 10.2 프론트 배포 — 권장: **두 앱 분리**

주민 / 기사님은 사용자층·UI 요구가 완전히 다르므로 **앱 두 개로 분리하는 걸 강력 추천**:

```
백엔드 (1개, 이미 있음)
└─ daramjwi-taxi-server.vercel.app
                 ↑   ↑
        ┌────────┘   └────────┐
        │                     │
  주민용 프론트          기사님용 프론트
  daramjwi-resident      daramjwi-admin
  (어르신 친화: 큰 글씨·큰 버튼·   (관리자 UI:
   단순한 흐름)                    캘린더·통계·합치기)
        │                     │
        ↓                     ↓
  다람쥐택시.com         admin.다람쥐택시.com
```

**왜 분리:**
- 사용자: 어르신(60~80대) vs 기사님(중장년 관리자) — UX 요구가 완전 다름
- 화면: 주민은 신청·내 예약 정도, 기사님은 캘린더·통계·합치기·전화신청 등 훨씬 복잡
- 배포 주기: 기사님 기능 추가가 주민 앱 영향 X (반대도 동일)
- 보안: 주민 앱에 admin API 호출 코드가 아예 없음 → 공격 표면 축소

**백엔드 변경 0**: 두 앱 모두 같은 `daramjwi-taxi-server.vercel.app` 부르면 됨. Bearer 토큰의 role로 자동 권한 분기 (`is_admin()` 함수 + RLS).

**Vercel 프로젝트:** 무료 Hobby 계정으로 백엔드 1 + 프론트 2 = **총 3개 무료 배포** 가능.

### 10.3 프론트 레포 구조 (선택)
- **A) 레포 2개 분리** (`daramjwi-taxi-resident`, `daramjwi-taxi-admin`) — 가장 깔끔, 권장
- **B) 모노레포** (`daramjwi-taxi-client/apps/{resident,admin}`) — 공통 코드 재사용 좋음
- **C) 한 앱 + URL 분기** (`daramjwi.com/`, `daramjwi.com/admin`) — 빠르지만 분리 장점 못 살림

프론트팀이 선택.

### 10.4 프론트 환경변수 (각 앱)
```bash
NEXT_PUBLIC_API_BASE_URL=https://daramjwi-taxi-server.vercel.app
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_xxxxx
# SERVICE_ROLE_KEY는 절대 프론트에 두지 않음 (백엔드 전용)
```

---

## ⚠️ 11. 현재 제약 / TODO

| 항목 | 현재 | 운영 전에 해야 함 |
|---|---|---|
| **SMS OTP 발신** | 미연동 | Solapi 또는 CoolSMS 계정 + 연동 |
| **카카오 로그인** | Supabase + 개인 카카오 앱은 KOE205 (account_email 필수) 막힘 | 카카오 비즈앱 (사업자등록증) 필요 — 일단은 SMS로만 |
| **알림톡** | stub | 카카오 비즈채널 + 알림톡 템플릿 승인 필요 |
| **개발용 로그인 (`ENABLE_DEV_LOGIN=true`)** | 켜져 있음 — `/api/dev/login`으로 토큰 즉시 발급 가능 | **운영 오픈 전 반드시 Vercel 환경변수에서 제거.** 백도어가 됨. |
| **공공일정 동기화** | 없음 | 사용자가 별도 요청 시 추가 |
| **운영 모니터링** | Vercel 기본 로그만 | Sentry 등 추가 권장 |

---

## 📚 12. 참고 문서

- [`docs/PROJECT_SPEC.md`](./PROJECT_SPEC.md) — 비즈니스 명세
- [`docs/HANDOFF.md`](./HANDOFF.md) — 백엔드 개발 히스토리
- [`docs/TEST_CHECKLIST.md`](./TEST_CHECKLIST.md) — 수동 검증 체크리스트
- [`docs/prototypes/admin-prototype.html`](./prototypes/admin-prototype.html) — 기사님용 UI 프로토타입
- [`docs/prototypes/resident-prototype.html`](./prototypes/resident-prototype.html) — 주민용 UI 프로토타입
- `supabase/migrations/*` — DB 스키마 + RPC 함수 (0001~0012):
  - 0001 초기 스키마 / 0002 RLS 정책 / 0003 예약 RPC 함수
  - 0004 거점 4개 정리 + profiles.address 제거
  - 0005 전화신청 (guest_name/phone)
  - 0006 Realtime publication
  - 0007 합치기 (departure_minute + merge RPC)
  - 0008 매트릭스 1시간 사이클
  - 0009 매트릭스 위치 추적 + 빈 복귀 1시간
  - 0010 카카오 로그인 컬럼 + push_subscriptions 테이블
  - 0011 매트릭스에 일/월 한도 반영
  - 0012 전화 신청 자동 회원 매칭 (phone → user_id)

---

## 💬 13. 문의

백엔드 담당: **백엔드 사장님** (this repo의 메인 커미터)
이 문서에 없는 케이스, 에러 응답 형태, 새 엔드포인트 요청 등은 Issue로 남겨주세요.

🐿️ Happy building!
