# 다람쥐 택시 — 백엔드 (daramjwi-taxi-server)

충북 옥천군 청산면 마을 공동 택시 신청 시스템의 **백엔드(API) 전용** 레포입니다.
프론트엔드는 별도 레포 `daramjwi-taxi-client` 에서 작업합니다.

- 스택: **Next.js 15 (App Router) API Routes + TypeScript + Supabase (PostgreSQL + Auth + RLS)**
- 전체 명세: [`PROJECT_SPEC.md`](./PROJECT_SPEC.md)

## 폴더 구조

```
app/
  api/
    health/route.ts      # 헬스체크 (GET /api/health)
  layout.tsx, page.tsx   # 최소 루트 (백엔드라 화면은 안내문만)
lib/
  supabase/
    server.ts            # anon 키 + 쿠키 세션 (RLS 적용) → 사용자 본인 권한
    admin.ts             # service_role 키 (RLS 우회) → 서버 전용 관리 작업
    types.ts             # DB 스키마 TypeScript 타입
supabase/
  migrations/
    20260522000001_initial_schema.sql   # PROJECT_SPEC 5.2 DDL
    20260522000002_rls_policies.sql      # RLS 정책
```

## 처음 셋업 (한 번만)

1. 의존성 설치: `npm install`
2. `.env.local.example` 를 복사해 `.env.local` 을 만들고 Supabase 키를 채웁니다.
3. Supabase 프로젝트의 SQL Editor에 `supabase/migrations/` 의 SQL을 **번호 순서대로** 실행합니다.
4. 개발 서버 실행: `npm run dev` → 브라우저에서 http://localhost:3000/api/health 확인.

> 자세한 단계별 안내(Supabase 프로젝트 만들기 등)는 셋업을 진행한 채팅 안내를 참고하세요.

## RLS 메모 (명세서 5.3과의 차이)

`is_admin()` SECURITY DEFINER 함수를 도입했습니다. 명세서 원문대로 admin 정책이
`profiles` 안에서 `profiles`를 다시 조회하면 PostgreSQL에서 무한재귀 오류가 나기 때문입니다.
또한 마스터 데이터 테이블에 "읽기 전용" RLS를 추가했습니다. 자세한 내용은
`supabase/migrations/20260522000002_rls_policies.sql` 상단 주석을 참고하세요.
