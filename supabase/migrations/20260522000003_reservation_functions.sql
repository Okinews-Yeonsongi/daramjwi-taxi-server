-- =============================================================
-- 0003 예약 신청 함수 (매트릭스 알고리즘 + 동시성 안전 예약 생성)
-- PROJECT_SPEC 4(매트릭스) · 6(원자적 생성) 기반
-- 모두 CREATE OR REPLACE 라 여러 번 실행해도 안전합니다.
-- =============================================================

-- 한 예약(출발카테고리 dep, 도착카테고리 arr, hour)이 막는 (카테고리, 시각) 셀 4칸
--   (dep, t-1) 출발준비 / (dep, t) 출발 / (dep, t+1) 도착측 / (arr, t) 운행중
CREATE OR REPLACE FUNCTION blocked_cells(p_dep TEXT, p_arr TEXT, p_hour INT)
RETURNS TABLE(category TEXT, hour INT)
LANGUAGE sql IMMUTABLE
AS $$
  SELECT c.category, c.hour
  FROM (VALUES
    (p_dep, p_hour - 1),
    (p_dep, p_hour),
    (p_dep, p_hour + 1),
    (p_arr, p_hour)
  ) AS c(category, hour)
  WHERE c.hour BETWEEN 9 AND 18;
$$;

-- 특정 (날짜, 시각, 출발카테고리)에서 특정 차량이 받을 수 있는 잔여 인원(0~4)
--   - 이미 그 칸에 운행이 있으면: 합승 잔여석(4 - 현재인원)
--   - 운행이 없으면: 새 운행이 막을 4칸이 모두 비었을 때만 4, 아니면 0
CREATE OR REPLACE FUNCTION vehicle_capacity_at(
  p_date DATE, p_hour INT, p_origin TEXT, p_vehicle_id INT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_arrival TEXT;
  v_run_total INT;
  v_conflict INT;
BEGIN
  v_arrival := CASE WHEN p_origin = 'cheongsanmyeon' THEN 'eupnae' ELSE 'cheongsanmyeon' END;

  SELECT COALESCE(SUM(r.persons), 0) INTO v_run_total
  FROM reservations r
  JOIN locations dep ON dep.id = r.departure_location_id
  WHERE r.vehicle_id = p_vehicle_id
    AND r.reservation_date = p_date
    AND r.hour = p_hour
    AND r.status IN ('waiting', 'confirmed')
    AND dep.category = p_origin;

  IF v_run_total > 0 THEN
    RETURN GREATEST(0, 4 - v_run_total);          -- 합승 잔여석
  END IF;

  -- 운행 없음 → 새 운행 가능한지(필요한 4칸이 비었는지) 검사
  SELECT COUNT(*) INTO v_conflict
  FROM blocked_cells(p_origin, v_arrival, p_hour) needed
  WHERE EXISTS (
    SELECT 1
    FROM reservations r
    JOIN locations dep ON dep.id = r.departure_location_id
    JOIN locations arr ON arr.id = r.arrival_location_id
    CROSS JOIN LATERAL blocked_cells(dep.category, arr.category, r.hour) bc
    WHERE r.vehicle_id = p_vehicle_id
      AND r.reservation_date = p_date
      AND r.status IN ('waiting', 'confirmed')
      AND bc.category = needed.category
      AND bc.hour = needed.hour
  );

  IF v_conflict = 0 THEN RETURN 4; ELSE RETURN 0; END IF;
END;
$$;

-- 차량 자동 배정: 합승 우선(A→B) → 빈 차량(A→B). 없으면 NULL.
CREATE OR REPLACE FUNCTION assign_vehicle(
  p_date DATE, p_hour INT, p_origin TEXT, p_persons INT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_total INT;
BEGIN
  -- 우선순위 1: 합승 (기존 운행에 합류, A 먼저)
  FOR v IN SELECT id FROM vehicles WHERE is_active ORDER BY code LOOP
    SELECT COALESCE(SUM(r.persons), 0) INTO v_total
    FROM reservations r
    JOIN locations dep ON dep.id = r.departure_location_id
    WHERE r.vehicle_id = v.id
      AND r.reservation_date = p_date
      AND r.hour = p_hour
      AND r.status IN ('waiting', 'confirmed')
      AND dep.category = p_origin;
    IF v_total > 0 AND v_total + p_persons <= 4 THEN
      RETURN v.id;
    END IF;
  END LOOP;

  -- 우선순위 2: 빈 차량 (새 운행, A 먼저)
  FOR v IN SELECT id FROM vehicles WHERE is_active ORDER BY code LOOP
    IF p_persons <= 4 AND vehicle_capacity_at(p_date, p_hour, p_origin, v.id) = 4 THEN
      RETURN v.id;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- 시간대별 가용성(잔여석)을 한 번에 조회 (9~18시)
CREATE OR REPLACE FUNCTION get_availability(p_date DATE, p_origin TEXT)
RETURNS TABLE(hour INT, remaining INT)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public
AS $$
  SELECT ts.hour,
    LEAST(4, GREATEST(
      vehicle_capacity_at(p_date, ts.hour, p_origin, (SELECT id FROM vehicles WHERE code = 'A')),
      vehicle_capacity_at(p_date, ts.hour, p_origin, (SELECT id FROM vehicles WHERE code = 'B'))
    )) AS remaining
  FROM time_slots ts
  ORDER BY ts.hour;
$$;

-- 동시성 안전 예약 생성 (같은 날짜는 직렬화하여 매트릭스 일관성 보장)
CREATE OR REPLACE FUNCTION create_reservation_atomic(
  p_user_id UUID, p_date DATE, p_hour INT,
  p_departure_id INT, p_arrival_id INT, p_persons INT
) RETURNS reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dep_cat TEXT;
  v_arr_cat TEXT;
  v_vehicle_id INT;
  v_new reservations;
BEGIN
  -- 본인 명의로만 예약 가능 (다른 사람 명의 차단)
  IF auth.uid() IS NULL OR auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  -- 같은 날짜 단위로 동시 예약 직렬화 (트랜잭션 종료 시 자동 해제)
  PERFORM pg_advisory_xact_lock(hashtext('daramjwi_reservation'), hashtext(p_date::text));

  IF p_persons < 1 OR p_persons > 4 THEN
    RAISE EXCEPTION 'INVALID_PERSONS';
  END IF;
  IF p_hour < 9 OR p_hour > 18 THEN
    RAISE EXCEPTION 'INVALID_HOUR';
  END IF;

  SELECT category INTO v_dep_cat FROM locations WHERE id = p_departure_id AND is_active;
  SELECT category INTO v_arr_cat FROM locations WHERE id = p_arrival_id AND is_active;
  IF v_dep_cat IS NULL OR v_arr_cat IS NULL THEN
    RAISE EXCEPTION 'INVALID_LOCATION';
  END IF;
  IF v_dep_cat = v_arr_cat THEN
    RAISE EXCEPTION 'SAME_CATEGORY';
  END IF;

  v_vehicle_id := assign_vehicle(p_date, p_hour, v_dep_cat, p_persons);
  IF v_vehicle_id IS NULL THEN
    RAISE EXCEPTION 'NO_VEHICLE';
  END IF;

  INSERT INTO reservations
    (user_id, reservation_date, hour, persons,
     departure_location_id, arrival_location_id, vehicle_id, status)
  VALUES
    (p_user_id, p_date, p_hour, p_persons,
     p_departure_id, p_arrival_id, v_vehicle_id, 'waiting')
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

-- RPC 실행 권한
GRANT EXECUTE ON FUNCTION get_availability(DATE, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_reservation_atomic(UUID, DATE, INT, INT, INT, INT) TO authenticated;
