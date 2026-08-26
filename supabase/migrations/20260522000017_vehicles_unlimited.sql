-- =============================================================
-- 0017 차량 대수 제한 해제 — 기사님 늘어나면 자동으로 차량 등록
--  - vehicles.code CHECK ('A','B') 제거 → 3대·4대·N대 가능
--  - code nullable + UNIQUE (NULL 다수 허용)
--  - assign_vehicle: ORDER BY id (기존 code 정렬)
--  - get_availability: 하드코딩 A/B 제거 → 모든 활성 차량 순회
-- =============================================================

-- 1) code 제약 완화
ALTER TABLE vehicles DROP CONSTRAINT IF EXISTS vehicles_code_check;
ALTER TABLE vehicles ALTER COLUMN code DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_code
  ON vehicles(code) WHERE code IS NOT NULL;

-- 2) assign_vehicle 재작성 (모든 활성 차량 순회, ID 순)
CREATE OR REPLACE FUNCTION assign_vehicle(
  p_date DATE, p_hour INT, p_origin TEXT, p_persons INT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_total INT;
BEGIN
  -- 우선순위 1: 합승 (기존 같은 방향에 합류, 등록 순서로)
  FOR v IN SELECT id FROM vehicles WHERE is_active ORDER BY id LOOP
    SELECT COALESCE(SUM(r.persons), 0) INTO v_total
    FROM reservations r
    JOIN locations dep ON dep.id = r.departure_location_id
    WHERE r.vehicle_id = v.id
      AND r.reservation_date = p_date AND r.hour = p_hour
      AND r.status IN ('waiting', 'confirmed')
      AND dep.category = p_origin;
    IF v_total > 0 AND v_total + p_persons <= 4 THEN
      RETURN v.id;
    END IF;
  END LOOP;

  -- 우선순위 2: 빈 차량 (그 시간 운행 없는 차, 등록 순서로)
  FOR v IN SELECT id FROM vehicles WHERE is_active ORDER BY id LOOP
    IF p_persons <= 4 AND vehicle_capacity_at(p_date, p_hour, p_origin, v.id) = 4 THEN
      RETURN v.id;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- 3) get_availability 재작성 (2대 하드코딩 제거)
CREATE OR REPLACE FUNCTION get_availability(
  p_date DATE, p_origin TEXT
) RETURNS TABLE(hour INT, remaining INT)
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  h INT;
  v RECORD;
  max_cap INT;
  cap INT;
BEGIN
  FOR h IN 9..18 LOOP
    max_cap := 0;
    FOR v IN SELECT id FROM vehicles WHERE is_active ORDER BY id LOOP
      cap := vehicle_capacity_at(p_date, h, p_origin, v.id);
      IF cap > max_cap THEN max_cap := cap; END IF;
    END LOOP;
    hour := h;
    remaining := LEAST(4, max_cap);
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION assign_vehicle(DATE, INT, TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assign_vehicle(DATE, INT, TEXT, INT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_availability(DATE, TEXT) TO authenticated;
