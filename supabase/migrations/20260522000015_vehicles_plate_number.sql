-- =============================================================
-- 0015 vehicles.plate_number 컬럼 추가
--  - 기사님이 온보딩에서 자기 차량번호 입력 → vehicles row와 매칭 후 vehicle_id 저장
--  - 매칭 없으면 빈 slot (plate_number NULL)에 자동 등록
--  - 시스템 내부는 여전히 vehicle_id (1=A, 2=B)로 매트릭스 계산
--  - 화면 표시만 실제 번호로 (예: "51허 1234")
-- =============================================================

ALTER TABLE vehicles
  ADD COLUMN IF NOT EXISTS plate_number TEXT;

-- 같은 번호 중복 등록 방지 (NULL 다수는 허용)
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_plate
  ON vehicles(plate_number) WHERE plate_number IS NOT NULL;
