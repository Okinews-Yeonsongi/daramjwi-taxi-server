-- =============================================================
-- 0014 기사님 담당 차량 매핑
--  - profiles.vehicle_id 컬럼 추가 (NULL 허용, vehicles FK)
--  - NULL이면 기존처럼 모든 예약 봄 (dev-login·기존 admin 호환)
--  - 값이 있으면 그 차량의 예약만 봄 (전화 배분 자동화)
--  - 여러 기사님이 같은 차량 담당 가능 (unique 제약 X — 대체 기사 대비)
--  - 멱등 (IF NOT EXISTS)
-- =============================================================

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS vehicle_id INT REFERENCES vehicles(id);

CREATE INDEX IF NOT EXISTS idx_profiles_vehicle ON profiles(vehicle_id) WHERE vehicle_id IS NOT NULL;

-- 편의 뷰: 각 차량별 담당 기사님 목록 (알림 대상 조회용)
CREATE OR REPLACE VIEW v_vehicle_admins AS
SELECT
  v.id AS vehicle_id,
  v.code AS vehicle_code,
  p.id AS admin_id,
  p.name AS admin_name,
  p.phone AS admin_phone
FROM vehicles v
JOIN profiles p ON p.vehicle_id = v.id
WHERE p.role = 'admin' AND p.status = 'active';
