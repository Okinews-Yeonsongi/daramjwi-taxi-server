-- =============================================================
-- 0002 RLS(행 수준 보안) 정책 — PROJECT_SPEC.md 5.3 기반
--
-- 명세서 5.3과의 차이 (의도된 보완, 자세한 설명은 README 참고):
--   1) 명세서의 "admin sees all profiles" 정책은 profiles 안에서 profiles를
--      다시 조회하므로 PostgreSQL에서 "infinite recursion detected in policy
--      for relation profiles" 오류가 납니다. 이를 막기 위해 SECURITY DEFINER
--      함수 public.is_admin() 으로 admin 판별을 분리했습니다.
--   2) 마스터 데이터(locations/time_slots/vehicles)에도 RLS를 켜고
--      "읽기만 허용" 정책을 추가했습니다. (anon 키로 마스터 데이터가
--      수정되는 것을 방지. service_role 키는 RLS를 우회하므로 변경 가능)
-- =============================================================

-- -------------------------------------------------------------
-- 헬퍼: 현재 로그인 사용자가 admin인지 판별
-- SECURITY DEFINER → 함수 소유자(postgres) 권한으로 실행되어 profiles의
-- RLS를 우회합니다. 덕분에 profiles 정책 안에서 호출해도 재귀가 없습니다.
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- =============================================================
-- profiles: 본인만 조회/수정, admin은 전체 조회
-- =============================================================
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "admin sees all profiles" ON profiles
  FOR SELECT USING (public.is_admin());

CREATE POLICY "users insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "users update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- =============================================================
-- reservations: 본인만 조회/생성/수정, admin은 전체 조회/수정
-- =============================================================
ALTER TABLE reservations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users see own reservations" ON reservations
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "admin sees all reservations" ON reservations
  FOR SELECT USING (public.is_admin());

CREATE POLICY "users create own reservations" ON reservations
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users update own reservations" ON reservations
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

CREATE POLICY "admin updates all reservations" ON reservations
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =============================================================
-- 마스터 데이터: 누구나 읽기 허용, 변경은 service_role 키로만
-- =============================================================
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can read locations" ON locations
  FOR SELECT USING (true);

CREATE POLICY "anyone can read time_slots" ON time_slots
  FOR SELECT USING (true);

CREATE POLICY "anyone can read vehicles" ON vehicles
  FOR SELECT USING (true);
