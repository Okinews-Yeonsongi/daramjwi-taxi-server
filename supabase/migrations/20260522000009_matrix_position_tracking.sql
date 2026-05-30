-- =============================================================
-- 0009 매트릭스 정교화: 차량 위치 추적 + 빈 복귀 1시간 버퍼
--  - 0008(시간 단위 점유)에 위치 호환성 추가
--  - 직전 운행 도착지 = 차 현재 위치
--  - 같은 방향이면 즉시(back-to-back), 다른 방향이면 빈복귀 1시간 필요 (= prev_hour + 2 이상)
--  - 다음 운행과도 같은 규칙으로 호환성 체크 (새 운행이 다음 운행을 방해하면 안 됨)
--  - 합승 규칙은 유지: (date, hour, vehicle, origin) 묶음당 운행 1회, 최대 4명
--  - 멱등 (CREATE OR REPLACE)
-- =============================================================

CREATE OR REPLACE FUNCTION vehicle_capacity_at(
  p_date DATE, p_hour INT, p_origin TEXT, p_vehicle_id INT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_arrival TEXT;
  v_run_total INT;
  v_other_count INT;
  v_prev_hour INT;
  v_prev_arr TEXT;
  v_next_hour INT;
  v_next_origin TEXT;
BEGIN
  v_arrival := CASE WHEN p_origin = 'cheongsanmyeon' THEN 'eupnae' ELSE 'cheongsanmyeon' END;

  -- (1) 같은 V·시각·같은 방향: 합승 잔여
  SELECT COALESCE(SUM(r.persons), 0) INTO v_run_total
  FROM reservations r
  JOIN locations dep ON dep.id = r.departure_location_id
  WHERE r.vehicle_id = p_vehicle_id
    AND r.reservation_date = p_date AND r.hour = p_hour
    AND r.status IN ('waiting', 'confirmed')
    AND dep.category = p_origin;
  IF v_run_total > 0 THEN
    RETURN GREATEST(0, 4 - v_run_total);
  END IF;

  -- (2) 같은 V·시각·다른 방향: V는 그 시간 다른 방향 운행 중 → 0
  SELECT COUNT(*) INTO v_other_count
  FROM reservations r
  JOIN locations dep ON dep.id = r.departure_location_id
  WHERE r.vehicle_id = p_vehicle_id
    AND r.reservation_date = p_date AND r.hour = p_hour
    AND r.status IN ('waiting', 'confirmed')
    AND dep.category <> p_origin;
  IF v_other_count > 0 THEN RETURN 0; END IF;

  -- (3) 직전 운행과 위치 호환성: 도착지 ≠ 새 출발지면 빈복귀 1시간 필요
  SELECT MAX(r.hour) INTO v_prev_hour
  FROM reservations r
  WHERE r.vehicle_id = p_vehicle_id
    AND r.reservation_date = p_date AND r.hour < p_hour
    AND r.status IN ('waiting', 'confirmed');

  IF v_prev_hour IS NOT NULL THEN
    SELECT arr.category INTO v_prev_arr
    FROM reservations r
    JOIN locations arr ON arr.id = r.arrival_location_id
    WHERE r.vehicle_id = p_vehicle_id
      AND r.reservation_date = p_date AND r.hour = v_prev_hour
      AND r.status IN ('waiting', 'confirmed')
    LIMIT 1;

    IF v_prev_arr <> p_origin AND p_hour < v_prev_hour + 2 THEN
      RETURN 0;
    END IF;
  END IF;

  -- (4) 다음 운행과 위치 호환성: 새 운행 도착지 ≠ 다음 운행 출발지면 빈복귀 필요
  SELECT MIN(r.hour) INTO v_next_hour
  FROM reservations r
  WHERE r.vehicle_id = p_vehicle_id
    AND r.reservation_date = p_date AND r.hour > p_hour
    AND r.status IN ('waiting', 'confirmed');

  IF v_next_hour IS NOT NULL THEN
    SELECT dep.category INTO v_next_origin
    FROM reservations r
    JOIN locations dep ON dep.id = r.departure_location_id
    WHERE r.vehicle_id = p_vehicle_id
      AND r.reservation_date = p_date AND r.hour = v_next_hour
      AND r.status IN ('waiting', 'confirmed')
    LIMIT 1;

    IF v_next_origin <> v_arrival AND v_next_hour < p_hour + 2 THEN
      RETURN 0;
    END IF;
  END IF;

  RETURN 4;
END;
$$;

-- assign_vehicle: 0008과 동일 (vehicle_capacity_at이 위치 인식하므로 자동 반영)
CREATE OR REPLACE FUNCTION assign_vehicle(
  p_date DATE, p_hour INT, p_origin TEXT, p_persons INT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_total INT;
BEGIN
  FOR v IN SELECT id FROM vehicles WHERE is_active ORDER BY code LOOP
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

  FOR v IN SELECT id FROM vehicles WHERE is_active ORDER BY code LOOP
    IF p_persons <= 4 AND vehicle_capacity_at(p_date, p_hour, p_origin, v.id) = 4 THEN
      RETURN v.id;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- merge_reservations_admin: 새 시각·새 출발지에 위치 호환 차량 선택 (선택된 예약은 제외)
CREATE OR REPLACE FUNCTION merge_reservations_admin(
  p_reservation_ids BIGINT[],
  p_new_hour INT,
  p_new_minute INT,
  p_confirmed_by UUID
) RETURNS SETOF reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_count INT; v_distinct_dates INT; v_distinct_deps INT;
  v_sum_persons INT; v_hour_diff INT;
  v_date DATE; v_dep_cat TEXT; v_arrival TEXT;
  v_vehicle_id INT; v RECORD;
  v_busy INT;
  v_prev_hour INT; v_prev_arr TEXT;
  v_next_hour INT; v_next_origin TEXT;
  v_month_start DATE; v_next_month DATE;
  v_daily_runs INT; v_monthly_runs INT;
BEGIN
  IF p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) < 2 THEN
    RAISE EXCEPTION 'MERGE_NEED_TWO';
  END IF;
  IF p_new_hour < 9 OR p_new_hour > 18 THEN RAISE EXCEPTION 'INVALID_HOUR'; END IF;
  IF p_new_minute NOT IN (0, 10, 20, 30, 40, 50) THEN RAISE EXCEPTION 'INVALID_MINUTE'; END IF;

  SELECT
    COUNT(*),
    COUNT(DISTINCT r.reservation_date),
    COUNT(DISTINCT dep.category),
    COALESCE(SUM(r.persons), 0),
    COALESCE(MAX(r.hour) - MIN(r.hour), 0),
    MIN(r.reservation_date),
    MIN(dep.category)
  INTO v_count, v_distinct_dates, v_distinct_deps, v_sum_persons, v_hour_diff, v_date, v_dep_cat
  FROM reservations r
  JOIN locations dep ON dep.id = r.departure_location_id
  WHERE r.id = ANY(p_reservation_ids) AND r.status = 'waiting';

  IF v_count <> array_length(p_reservation_ids, 1) THEN RAISE EXCEPTION 'MERGE_NOT_ALL_WAITING'; END IF;
  IF v_distinct_dates <> 1 THEN RAISE EXCEPTION 'MERGE_DATE_MISMATCH'; END IF;
  IF v_distinct_deps <> 1 THEN RAISE EXCEPTION 'MERGE_CATEGORY_MISMATCH'; END IF;
  IF v_hour_diff > 1 THEN RAISE EXCEPTION 'MERGE_HOUR_RANGE'; END IF;
  IF v_sum_persons > 4 THEN RAISE EXCEPTION 'MERGE_OVER_CAPACITY'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext('daramjwi_reservation'), hashtext(v_date::text));

  v_arrival := CASE WHEN v_dep_cat = 'cheongsanmyeon' THEN 'eupnae' ELSE 'cheongsanmyeon' END;

  FOR v IN SELECT id FROM vehicles WHERE is_active ORDER BY code LOOP
    -- (a) 새 시각에 다른 운행 없음
    SELECT COUNT(*) INTO v_busy
    FROM reservations r
    WHERE r.vehicle_id = v.id
      AND r.reservation_date = v_date AND r.hour = p_new_hour
      AND r.status IN ('waiting', 'confirmed')
      AND NOT (r.id = ANY(p_reservation_ids));
    IF v_busy > 0 THEN CONTINUE; END IF;

    -- (b) 직전 운행 위치 호환성
    SELECT MAX(r.hour) INTO v_prev_hour
    FROM reservations r
    WHERE r.vehicle_id = v.id
      AND r.reservation_date = v_date AND r.hour < p_new_hour
      AND r.status IN ('waiting', 'confirmed')
      AND NOT (r.id = ANY(p_reservation_ids));
    IF v_prev_hour IS NOT NULL THEN
      SELECT arr.category INTO v_prev_arr
      FROM reservations r
      JOIN locations arr ON arr.id = r.arrival_location_id
      WHERE r.vehicle_id = v.id
        AND r.reservation_date = v_date AND r.hour = v_prev_hour
        AND r.status IN ('waiting', 'confirmed')
        AND NOT (r.id = ANY(p_reservation_ids))
      LIMIT 1;
      IF v_prev_arr <> v_dep_cat AND p_new_hour < v_prev_hour + 2 THEN
        CONTINUE;
      END IF;
    END IF;

    -- (c) 다음 운행 위치 호환성
    SELECT MIN(r.hour) INTO v_next_hour
    FROM reservations r
    WHERE r.vehicle_id = v.id
      AND r.reservation_date = v_date AND r.hour > p_new_hour
      AND r.status IN ('waiting', 'confirmed')
      AND NOT (r.id = ANY(p_reservation_ids));
    IF v_next_hour IS NOT NULL THEN
      SELECT dep.category INTO v_next_origin
      FROM reservations r
      JOIN locations dep ON dep.id = r.departure_location_id
      WHERE r.vehicle_id = v.id
        AND r.reservation_date = v_date AND r.hour = v_next_hour
        AND r.status IN ('waiting', 'confirmed')
        AND NOT (r.id = ANY(p_reservation_ids))
      LIMIT 1;
      IF v_next_origin <> v_arrival AND v_next_hour < p_new_hour + 2 THEN
        CONTINUE;
      END IF;
    END IF;

    v_vehicle_id := v.id;
    EXIT;
  END LOOP;

  IF v_vehicle_id IS NULL THEN RAISE EXCEPTION 'NO_VEHICLE'; END IF;

  v_month_start := date_trunc('month', v_date)::date;
  v_next_month := (date_trunc('month', v_date) + INTERVAL '1 month')::date;

  SELECT COUNT(*) INTO v_daily_runs FROM (
    SELECT DISTINCT reservation_date, hour, vehicle_id FROM reservations
    WHERE status = 'confirmed' AND reservation_date = v_date
      AND NOT (id = ANY(p_reservation_ids))
  ) t;
  IF v_daily_runs + 1 > 4 THEN RAISE EXCEPTION 'DAILY_LIMIT'; END IF;

  SELECT COUNT(*) INTO v_monthly_runs FROM (
    SELECT DISTINCT reservation_date, hour, vehicle_id FROM reservations
    WHERE status = 'confirmed'
      AND reservation_date >= v_month_start AND reservation_date < v_next_month
      AND NOT (id = ANY(p_reservation_ids))
  ) t;
  IF v_monthly_runs + 1 > 112 THEN RAISE EXCEPTION 'MONTHLY_LIMIT'; END IF;

  UPDATE reservations
  SET hour = p_new_hour,
      departure_minute = p_new_minute,
      vehicle_id = v_vehicle_id,
      status = 'confirmed',
      confirmed_at = NOW(),
      confirmed_by = p_confirmed_by,
      updated_at = NOW()
  WHERE id = ANY(p_reservation_ids);

  RETURN QUERY SELECT * FROM reservations WHERE id = ANY(p_reservation_ids);
END;
$$;

REVOKE EXECUTE ON FUNCTION merge_reservations_admin(BIGINT[], INT, INT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merge_reservations_admin(BIGINT[], INT, INT, UUID) TO service_role;
