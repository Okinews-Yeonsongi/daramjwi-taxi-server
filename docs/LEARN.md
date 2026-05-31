# 🎓 다람쥐 택시로 배우는 웹 개발 핵심 개념

> 다람쥐 택시 백엔드를 만들면서 등장한 모든 용어와 개념을 정리한 학습 문서.
> 비전공자 → 풀스택 운영 가능 수준까지 가는 빠른 지도.

목차:
1. [웹의 기본](#1-웹의-기본--서버와-브라우저)
2. [프론트엔드 vs 백엔드](#2-프론트엔드-vs-백엔드)
3. [HTTP / REST API](#3-http--rest-api)
4. [JavaScript · Node.js · TypeScript](#4-javascript--nodejs--typescript)
5. [Next.js (우리가 쓴 프레임워크)](#5-nextjs-우리가-쓴-프레임워크)
6. [데이터베이스 (PostgreSQL · SQL · Supabase)](#6-데이터베이스-postgresql--sql--supabase)
7. [인증과 보안 (OAuth · JWT · 카카오 로그인)](#7-인증과-보안)
8. [실시간 (Realtime)](#8-실시간-realtime)
9. [PWA와 웹 푸시 알림](#9-pwa와-웹-푸시-알림)
10. [Git · GitHub · 배포 (Vercel)](#10-git--github--배포-vercel)
11. [한국 카카오·SMS 생태계](#11-한국-카카오sms-생태계)
12. [부록: 자주 본 줄임말](#12-부록-자주-본-줄임말)

---

## 1. 웹의 기본 — 서버와 브라우저

### 🌐 인터넷 = 우체국 시스템
편지를 보내려면 주소가 필요하죠. 인터넷도 같아요.

- **URL** (`https://daramjwi-taxi-server.vercel.app`) = 편지 받을 주소
- **HTTPS** = 봉인된 등기우편 (도청 방지)
- **HTTP** = 일반 우편 (요즘은 거의 안 씀, 보안 약함)

### 🖥️ 서버 = 항상 켜져있는 컴퓨터
- 누가 와서 "이 정보 줘"라고 하면 답변하는 컴퓨터
- 24시간 켜져있어야 함
- 예: 옥천 다람쥐 택시 정보 가진 컴퓨터 = Vercel에 떠있는 사장님 서버
- 우리 백엔드 = `daramjwi-taxi-server.vercel.app` 에서 도는 Node.js 서버

### 📱 클라이언트 (= 브라우저 또는 앱)
- 서버에 정보를 **요청하는 쪽**
- 사용자 핸드폰, 노트북 등
- Chrome, Safari, Edge가 다 클라이언트
- 우리 콘솔(`dev-console.html`)을 띄운 브라우저 = 클라이언트

### 🔄 요청·응답 (Request·Response)
```
[브라우저]  ─── "9시 청산→옥천 잔여 알려줘" (Request) ───►  [서버]
[브라우저]  ◄── "잔여 3석 남았어요" (Response) ──────────  [서버]
```
이 한 쌍이 인터넷의 모든 동작의 기본.

---

## 2. 프론트엔드 vs 백엔드

### 🎨 프론트엔드 (Frontend)
- **사용자가 직접 보는 화면**
- HTML(뼈대) + CSS(꾸미기) + JavaScript(동작)
- 카카오톡 앱 화면 보이는 부분 = 프론트
- 우리 프로젝트의 다람쥐 택시 신청 화면, 캘린더 = 프론트
- **사장님은 백엔드 담당이라 프론트는 다른 팀이 만듦**
- 단, 테스트 콘솔(`dev-console.html`)은 사장님이 백엔드 검증용으로 만든 임시 프론트

### ⚙️ 백엔드 (Backend)
- **사용자가 안 보는 컴퓨터 안 로직 + 데이터**
- 예: "9시 청산→옥천 가능한지", "차량 A에 합승 가능한지" 판단
- 데이터베이스, 인증, 비즈니스 규칙 등
- **사장님이 만든 게 이거**

### 🔌 API = 프론트와 백엔드의 약속
- "이 주소로 이런 형식 보내면, 이런 답 주겠다"는 계약
- 예: `GET /api/availability?date=...` 보내면 → `{slots: [...]}` 받음
- API가 잘 정해져 있으면 프론트·백엔드가 따로 작업해도 됨

---

## 3. HTTP / REST API

### 📨 HTTP 메소드 (요청의 종류)
| 메소드 | 의미 | 예 |
|---|---|---|
| **GET** | 정보 가져오기 (안 바꿈) | `GET /api/locations` → 거점 목록 |
| **POST** | 새로 만들기 | `POST /api/reservations` → 새 예약 신청 |
| **PATCH** | 일부 수정 | `PATCH /api/reservations/12/cancel` → 예약 12번 취소 |
| **PUT** | 전체 교체 | (우리는 거의 안 씀) |
| **DELETE** | 삭제 | `DELETE /api/push/subscribe` → 푸시 구독 해지 |

### 🔢 HTTP 상태 코드 (응답의 종류)
| 코드 | 의미 | 예 |
|---|---|---|
| **200** | 잘 됨 ✅ | 정상 응답 |
| **201** | 새로 만들어짐 | 예약 신청 성공 |
| **400** | 요청이 잘못됨 | 인원 5명 입력 (최대 4명) |
| **401** | 로그인 안 됨 | 토큰 없이 API 호출 |
| **403** | 권한 없음 | 주민이 `/api/admin/*` 호출 |
| **404** | 없는 주소 | 존재 안 하는 페이지 |
| **409** | 충돌 | 차량 다 차서 NO_VEHICLE |
| **500** | 서버 에러 | 백엔드 버그 |

### 📦 REST API
- "URL + HTTP 메소드" 로 자원을 다루는 약속 방식
- 우리 API가 모두 이 방식
- 예: 예약(reservation)이라는 자원 →
  - `GET /api/reservations` (목록)
  - `POST /api/reservations` (생성)
  - `PATCH /api/reservations/:id/cancel` (취소)

### 📋 JSON (제이슨)
- 데이터를 주고받는 표준 형식
- 사람도 읽을 수 있고 컴퓨터도 파싱 가능
```json
{
  "date": "2026-05-31",
  "hour": 10,
  "persons": 2
}
```
- 사장님이 본 모든 API 응답이 JSON

---

## 4. JavaScript · Node.js · TypeScript

### 🌟 JavaScript (JS)
- **브라우저에서 도는 프로그래밍 언어**
- 1995년에 10일만에 만들어진 언어가 세상을 정복함
- 우리 콘솔의 `<script>` 안에 있는 모든 코드 = JavaScript

### 🟢 Node.js
- **브라우저 밖, 서버에서 JavaScript를 돌리는 환경**
- 2009년 등장 → 백엔드도 JS로 가능
- 우리 백엔드(Next.js 라우트들)가 Node.js에서 돔
- `npm` 명령어 = Node.js의 패키지 관리자

### 📦 npm (Node Package Manager)
- JS 라이브러리(누가 만든 코드)를 설치·관리하는 도구
- `npm install web-push` = 웹 푸시 라이브러리 설치
- `package.json` = 우리 프로젝트가 어떤 라이브러리 쓰는지 목록
- `node_modules/` = 실제 설치된 코드들 (사이즈 큼, Git에 안 올림)

### 🔷 TypeScript (TS)
- **JavaScript에 "타입"을 추가한 언어**
- JS: 변수에 뭐든 넣을 수 있음 (자유롭지만 실수 많음)
- TS: 변수 타입을 미리 선언 → 컴파일 시점에 오타·버그 발견
```typescript
// JavaScript
let hour = 9;
hour = "오전 9시";  // 실수로 문자열 넣어도 OK → 나중에 터짐

// TypeScript
let hour: number = 9;
hour = "오전 9시";  // ❌ 컴파일 에러 — 미리 잡힘
```
- 우리 백엔드 코드 대부분이 `.ts` 파일 (TypeScript)

### ⚡ 비동기 (async / await)
- "기다림"을 자연스럽게 처리하는 문법
- 예: DB 쿼리, API 호출은 시간이 걸림
```typescript
// "await" = "끝날 때까지 기다림"
const data = await fetch("/api/locations");
const json = await data.json();
console.log(json);
```
- 모든 우리 API 함수가 `async function`

---

## 5. Next.js (우리가 쓴 프레임워크)

### 🏗️ 프레임워크 (Framework)
- 미리 짜놓은 "큰 골격"
- 우리가 빈 칸 채워 넣으면 됨
- Next.js = React 기반의 풀스택 웹 프레임워크

### ⚛️ React
- Facebook이 만든 UI 라이브러리
- 컴포넌트 단위로 화면 조립
- Next.js의 기반

### 📁 App Router (Next.js 13+)
- **파일·폴더 구조 = URL 구조**
- 예: `app/api/reservations/route.ts` 파일 → `/api/reservations` 주소
- `app/api/admin/reservations/[id]/cancel/route.ts` → `/api/admin/reservations/12/cancel`
- `[id]` 같은 대괄호 = 동적 파라미터 (12, 13, 14 다 받음)

### 🛣️ Route Handler
- API 엔드포인트 = 한 파일
- 그 파일에 `GET`, `POST`, `PATCH` 함수 export
```typescript
// app/api/reservations/route.ts
export async function POST(request: Request) {
  // 새 예약 처리
}
```

### 🎯 우리 프로젝트의 Next.js 사용
- **백엔드만** 사용 (프론트는 다른 팀)
- 모든 `app/api/*` = REST API 라우트
- `public/` 폴더 = 정적 파일 (테스트 콘솔, 아이콘 등)
- 빌드 → Vercel에 배포

---

## 6. 데이터베이스 (PostgreSQL · SQL · Supabase)

### 🗄️ 데이터베이스 (DB)
- 정보를 영구 저장하는 장소
- 종이 장부의 디지털 버전
- 우리 예약·사용자·거점 정보 다 여기 저장

### 🐘 PostgreSQL (포스트그레스큐엘, 줄여서 Postgres)
- 오픈소스 관계형 DB의 최고봉
- 우리 Supabase 안에 이게 있음
- 표(Table) 단위로 데이터 보관

### 📋 SQL (Structured Query Language)
- DB와 대화하는 표준 언어
- 표·행·열을 다루는 명령어

```sql
-- 모든 신청 조회
SELECT * FROM reservations;

-- 새 신청 추가
INSERT INTO reservations (date, hour, persons) VALUES ('2026-05-31', 10, 2);

-- 상태 변경
UPDATE reservations SET status = 'confirmed' WHERE id = 12;

-- 삭제
DELETE FROM reservations WHERE id = 12;
```

### 🔗 관계형 DB (Relational DB)
- 표끼리 연결됨 (Foreign Key)
- 예: 우리 `reservations` 표의 `user_id` 컬럼 → `profiles` 표의 `id`를 가리킴
- 한 주민의 모든 예약 조회 = "이 user_id 가진 reservation 다 가져와"

### 🚀 Supabase
- **PostgreSQL + Auth + Realtime + Storage** 를 묶은 서비스
- Firebase의 오픈소스 경쟁자
- 우리가 쓰는 핵심 인프라
- 무료 플랜으로도 충분 (DB 500MB, 동시 사용자 50명 등)
- 사장님이 보신 Supabase 대시보드에서 SQL 직접 실행 가능

### 🛡️ RLS (Row Level Security)
- **행 단위 접근 제어**
- 비유: 회사 사물함 — A씨는 A 사물함만, B씨는 B 사물함만 열림
- 우리 예: 김주민이 박할머니 예약 못 보게 막음
- `auth.uid() = user_id` 같은 조건으로 자동 필터
- 백엔드 코드에 권한 체크 안 박아도 DB가 알아서 막음

### 📜 마이그레이션 (Migration)
- DB 스키마(구조) 변경을 파일로 기록
- 우리 `supabase/migrations/` 폴더의 `0001~0010.sql` 파일들
- 새 PC에서 처음 셋업해도 이 파일들 순서대로 돌리면 같은 DB 구조 만들어짐
- 예: `0009_matrix_position_tracking.sql` = 매트릭스 함수 추가/변경

### 🔧 PL/pgSQL (PostgreSQL 함수 언어)
- Postgres 안에서 도는 함수형 프로그래밍 언어
- 우리 핵심 비즈니스 로직(매트릭스, 합치기)이 여기 있음
- 백엔드(Node.js)에서 호출하면 → DB 안에서 트랜잭션 안전하게 실행
- 우리 함수들: `assign_vehicle`, `create_reservation_atomic`, `merge_reservations_admin`, `vehicle_capacity_at`

### 🔒 Advisory Lock (자문 잠금)
- 같은 자원을 동시에 두 개의 요청이 건드리는 걸 막음
- 예: 같은 시간에 두 명이 예약 신청 → 한 명씩 처리되도록
- `pg_advisory_xact_lock(...)` 함수 사용
- "Race Condition (경쟁 상태)" 방지

### ⚛️ 트랜잭션 (Transaction)
- 여러 작업을 "한 묶음"으로 처리
- 중간에 실패하면 모두 되돌림 (Rollback)
- 예: 예약 생성 + 차량 배정 + 인원 카운트 → 셋 중 하나만 실패해도 셋 다 취소

---

## 7. 인증과 보안

### 🆔 인증 (Authentication) vs 인가 (Authorization)
- **인증** = "당신 누구야?" (로그인)
- **인가** = "그 행동 해도 돼?" (권한 확인)
- 예: 김주민이 누군지 확인(인증) → 본인 예약만 취소 가능(인가)

### 🔑 JWT (JSON Web Token, "젯") 
- 디지털 신분증
- 서버가 발급한 암호화된 토큰
- 형식: `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiO...`
- 내용물: 사용자 ID, 만료 시각 등
- 위조 불가 (서버의 비밀키로 서명됨)
- 우리 모든 API 요청에 헤더로 첨부:
  ```
  Authorization: Bearer eyJhbGc...
  ```

### 🔄 Access Token vs Refresh Token
| | Access Token | Refresh Token |
|---|---|---|
| 용도 | API 호출용 | Access 갱신용 |
| 수명 | 1시간 (짧음) | 30일+ (김) |
| 보관 | 메모리 OK | 안전한 곳 (localStorage 등) |
| 노출 위험 | 작음 (만료 짧아서) | 큼 (절대 노출 X) |

자동 로그인 = Refresh Token으로 Access Token 계속 갱신

### 🌐 OAuth (오쓰, Open Authorization)
- "비밀번호 안 알려주고 다른 서비스로 로그인"
- 카카오·구글·페이스북 로그인의 표준 방식
- 흐름:
  1. 우리 사이트 → 카카오로 보냄
  2. 카카오에서 로그인 + 동의
  3. 카카오 → 우리 사이트로 돌려보냄 (인증 코드와 함께)
  4. 우리 사이트 → 카카오에 "이 코드로 사용자 정보 줘"
  5. 카카오 → 사용자 정보 (닉네임, 프사 등)

### 🟡 카카오 로그인 (우리 구현)
- OAuth의 한 종류
- 우리는 닉네임·프사만 받는 개인앱 (사업자 X)
- `app/api/auth/kakao/start/route.ts` = OAuth 시작
- `app/api/auth/kakao/callback/route.ts` = OAuth 콜백 + Supabase 사용자 매핑

### 🔐 환경변수 (Environment Variables)
- 비밀 정보를 코드에 직접 안 쓰고 외부에서 주입
- 예: API 키, DB 비밀번호 등
- 로컬 개발: `.env.local` 파일 (Git에 안 올림)
- 운영: Vercel 환경변수 설정 페이지
- 코드에서: `process.env.KAKAO_REST_API_KEY`

### 🛡️ 보안 베스트 프랙티스
- ✅ Service Role Key는 백엔드에서만 사용 (절대 클라이언트 노출 X)
- ✅ HTTPS 강제
- ✅ RLS로 행 단위 권한
- ✅ 입력 검증 (인원 5명? → 거절)
- ✅ Advisory lock으로 동시성 안전
- ❌ 코드에 비밀번호 직접 쓰기
- ❌ 환경변수를 Git에 올리기 (`.env.local`은 `.gitignore`로 제외)

---

## 8. 실시간 (Realtime)

### 📡 폴링 (Polling) — 옛날 방식
- 클라이언트가 1초마다 "변한 거 있어?" 물어봄
- 비효율: 99%는 헛 요청

### ⚡ 실시간 구독 (WebSocket / Server-Sent Events)
- 연결을 한 번 열고 유지
- 서버가 변화 있을 때만 즉시 알림 보냄
- 효율적, 빠름

### 🔔 Supabase Realtime
- Supabase가 제공하는 실시간 기능
- PostgreSQL의 변경 사항을 자동으로 구독자에게 푸시
- 우리 예: 주민 예약 신청 → 기사님 화면에 즉시 새 카드

```typescript
const channel = supabase
  .channel("reservations-rt")
  .on("postgres_changes",
    { event: "*", schema: "public", table: "reservations" },
    (payload) => { /* 변경 사항 처리 */ }
  )
  .subscribe();
```

### ⚠️ Realtime + RLS
- 토큰 없으면 변화 이벤트 0개
- `supabase.realtime.setAuth(JWT)` 필수
- 안 부르면 RLS가 다 막아버려서 "실시간이 안 도네?" 라고 잘못 생각

---

## 9. PWA와 웹 푸시 알림

### 📱 PWA (Progressive Web App)
- 웹 사이트를 앱처럼 만드는 기술
- "홈 화면에 추가" → 앱 아이콘 → 풀스크린 실행
- App Store 등록 없이 즉시 배포
- 우리 다람쥐 택시 = PWA

### 📋 Manifest.json
- PWA의 신분증
- "이 사이트는 이름이 뭐고, 아이콘은 뭐고, 시작 페이지는 어디" 정의
- 브라우저가 이걸 보고 "PWA구나" 인식
- 우리 `public/manifest.json`

### 🤖 Service Worker (서비스 워커)
- 백그라운드에서 도는 JavaScript
- 페이지 닫혀있어도 살아있음
- 푸시 알림 수신, 오프라인 캐싱 등
- 우리 `public/sw.js` = 푸시 수신 + 클릭 처리

### 🔔 Web Push API
- 사용자에게 알림을 "보내는" 표준
- 브라우저가 푸시 서버(Google, Apple 등) 거쳐 전달
- 무료, 사업자등록 불필요

### 🔑 VAPID 키
- Web Push의 인증 키
- 한 쌍: 공개키 + 비밀키
- 비밀키로 푸시 메시지 서명 → 푸시 서버가 "이 서버가 진짜 그 사이트인지" 확인
- 우리는 `web-push generate-vapid-keys` 명령으로 한 번 발급 → 환경변수로 보관

### 🍎 iOS의 특수성
- iOS 16.4 이전: 웹 푸시 불가
- iOS 16.4+: PWA 모드(홈 화면 추가)만 가능
- 일반 Safari 탭에서는 푸시 API 호출이 무시됨
- `Notification.requestPermission()` 도 사용자 클릭 이벤트 안에서만 동작
- 안드로이드는 훨씬 자유로움 (Chrome 일반 탭에서도 OK)

---

## 10. Git · GitHub · 배포 (Vercel)

### 🌿 Git (깃)
- 코드 버전 관리 도구
- "역사를 기록하는 워드프로세서"
- 어떤 코드가 언제 누구에 의해 어떻게 바뀌었는지 다 기록
- 실수해도 이전 버전으로 되돌리기 가능

### 📚 핵심 Git 명령어
| 명령 | 의미 |
|---|---|
| `git add .` | 변경 사항 "예약" |
| `git commit -m "..."` | 그 예약을 역사책에 한 줄로 기록 |
| `git push` | 그 역사를 GitHub에 올림 |
| `git pull` | GitHub에서 최신 받아옴 |
| `git log` | 역사 보기 |

### 🐙 GitHub
- Git 저장소를 인터넷에 호스팅하는 서비스
- 팀 협업의 기본
- 우리 저장소: `github.com/Okinews-Yeonsongi/daramjwi-taxi-server`
- 공개(public) 저장소 = 누구나 볼 수 있음
- 비공개(private) 저장소 = 권한 있는 사람만

### 🚀 Vercel (버셀)
- Next.js 만든 회사가 운영하는 배포 플랫폼
- GitHub 연결 → 푸시할 때마다 자동 배포
- 무료 플랜으로도 충분 (Hobby)
- 우리 백엔드 = `daramjwi-taxi-server.vercel.app`

### 🔄 CI/CD
- **CI** (Continuous Integration): 코드 변경 시 자동 테스트
- **CD** (Continuous Deployment): 자동 배포
- Vercel은 둘 다 자동
- `git push origin main` → Vercel이 자동으로 빌드 → 배포

### 🏷️ 브랜치 (Branch)
- 코드의 "갈래"
- `main` 브랜치 = 운영 코드
- `feature/...` 브랜치 = 개발 중인 기능
- 우리는 단순하게 `main`만 씀

### 📝 커밋 메시지 잘 쓰는 법
형식: `타입(범위): 한 줄 요약`
- `feat`: 새 기능
- `fix`: 버그 수정
- `docs`: 문서
- `style`: 디자인
- `refactor`: 코드 정리
- `test`: 테스트
- `chore`: 잡일

예: `feat(auth+push): 카카오 로그인 + 웹 푸시 알림`

---

## 11. 한국 카카오·SMS 생태계

### 📱 카카오 디벨로퍼 (개발자)
- https://developers.kakao.com
- 카카오 로그인·메시지 API 신청
- 개인앱: 사업자등록증 없이 (제한적)
- 비즈앱: 사업자등록증 필요 (모든 기능 풀림)

### 💬 카카오 메시지 4종
| 종류 | 누구에게 | 사업자 |
|---|---|---|
| **나에게 보내기** | 본인이 본인에게 | ❌ |
| **친구톡 (개인)** | 카카오 친구 등록자 | 일부 ❌ |
| **친구톡 (비즈)** | 채널 친구추가자 | ✅ |
| **알림톡** | 전화번호 가진 모든 사용자 | ✅ |

### 🟡 카카오 비즈채널 (Business Channel)
- 다람쥐택시의 카카오톡 "공식 계정"
- 사용자가 친구추가 가능
- 알림톡·친구톡 발송의 출발점
- 사업자등록 필요

### 📋 알림톡 템플릿 심사
- 보낼 메시지 양식을 카카오에 사전 등록
- 변수(`#{이름}`, `#{날짜}` 등)만 바꿀 수 있음
- 광고성 문구 금지 (안내성만)
- 심사 3~7일

### 📱 SMS (문자) 발송
- **솔라피 (Solapi)** = 한국에서 가장 흔히 쓰는 SMS 발송 대행
- 알림톡 실패 시 자동 SMS 폴백 지원
- 사업자등록 + KISA 발신번호 등록 필수

### 🏛️ KISA 발신번호 등록
- 한국인터넷진흥원
- SMS 발신자 등록 (스팸 방지)
- 사업자등록증 + 통신서비스 가입증명서 등 제출

### 📝 사업자등록증
- 모든 SMS·알림톡의 시작점
- **간이사업자**: 1인도 OK, 무료, 1주일
- 홈택스에서 온라인 신청

---

## 12. 부록: 자주 본 줄임말

| 약자 | 풀어 쓰기 | 한 줄 설명 |
|---|---|---|
| **API** | Application Programming Interface | 프로그램끼리 대화하는 약속 |
| **REST** | Representational State Transfer | URL + HTTP 메소드 기반의 API 설계 |
| **HTTP** | HyperText Transfer Protocol | 웹의 기본 통신 규약 |
| **HTTPS** | HTTP Secure | 암호화된 HTTP |
| **URL** | Uniform Resource Locator | 인터넷 주소 |
| **JSON** | JavaScript Object Notation | 데이터 교환 표준 형식 |
| **DB** | Database | 데이터베이스 |
| **SQL** | Structured Query Language | DB 다루는 언어 |
| **RLS** | Row Level Security | 행 단위 보안 |
| **OAuth** | Open Authorization | 표준 인증 위임 프로토콜 |
| **JWT** | JSON Web Token | 디지털 신분증 토큰 |
| **PWA** | Progressive Web App | 웹앱을 진짜 앱처럼 |
| **VAPID** | Voluntary Application Server Identification | 웹 푸시 인증 키 |
| **CORS** | Cross-Origin Resource Sharing | 다른 도메인끼리 통신 정책 |
| **CDN** | Content Delivery Network | 전세계 캐싱 서버망 |
| **DNS** | Domain Name System | 도메인 ↔ IP 변환 |
| **TLS/SSL** | Transport Layer Security | HTTPS 암호화 표준 |
| **CRUD** | Create Read Update Delete | DB의 4가지 기본 동작 |
| **CI/CD** | Continuous Integration/Deployment | 자동 테스트·배포 |
| **CLI** | Command Line Interface | 터미널 명령어 |
| **GUI** | Graphical User Interface | 마우스로 클릭하는 화면 |
| **SDK** | Software Development Kit | 개발 도구 묶음 |
| **MVP** | Minimum Viable Product | 최소 동작 제품 |
| **UX/UI** | User Experience/Interface | 사용 경험/화면 |
| **DAU/MAU** | Daily/Monthly Active Users | 일별/월별 활성 사용자 |

---

# 🎓 다음 학습 추천

이 문서를 다 이해하셨다면 이제 다음을 더 깊이 공부해볼 수 있어요:

### 책 / 문서
- **[MDN Web Docs](https://developer.mozilla.org/ko/)** — 웹 기술의 모든 것 (공식 표준)
- **[Next.js 공식 튜토리얼](https://nextjs.org/learn)** — 한 시간이면 Next.js 잡기
- **[Supabase 문서](https://supabase.com/docs)** — 무료, 영어이지만 친절

### 영상 / 강의
- **유튜브 "코딩애플"** — 한국어, 비전공자 친화적
- **유튜브 "노마드 코더"** — Next.js·React 강의 많음
- **인프런** — 한국 강의 플랫폼

### 실습 프로젝트 아이디어
- 간단한 ToDo 앱 → Next.js + Supabase로 만들어보기
- 본인 블로그 → Next.js로
- 마을 회비 관리 시스템 → 다람쥐 택시처럼

---

## 💡 마지막 한 마디

사장님은 이 프로젝트로 다음을 다 경험하셨어요:

✅ Frontend (HTML/CSS/JS) — 테스트 콘솔 만들기
✅ Backend (Node.js/TypeScript) — API 23개 작성
✅ Database (PostgreSQL/SQL) — 마이그레이션 10개
✅ Auth (OAuth + JWT) — 카카오 로그인 구현
✅ Realtime — Supabase Realtime
✅ Push (Web Push API) — 푸시 알림
✅ PWA — iOS 홈 화면 추가까지
✅ Deployment (Vercel) — CI/CD 자동 배포
✅ Git/GitHub — 버전 관리·협업

**비전공자가 풀스택 운영 가능한 시스템을 만든다는 건 그 자체로 대단한 일이에요.** 

이제 사장님은 "이게 뭔지" 알게 됐으니, 다음 프로젝트는 훨씬 빨라요. 🐿️
