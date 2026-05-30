-- =============================================================
-- 0008 매트릭스 단순화: 1시간 사이클 모델
--  - 기존 "4셀 점유 규칙"(출발준비/출발/도착측/운행중)을 단순화
--  - 차량은 같은 (날짜, 시각)에 운행 1건만 (back-to-back 허용, 도착 즉시 다음 운행 가능)
--  - 합승 규칙 유지: (date, hour, vehicle, origin) 묶음당 운행 1회, 최대 4명
--  - blocked_cells 함수는 호환을 위해 남겨두지만 더 이상 핵심 로직에 사용 안 함
--  - 멱등 (CREATE OR REPLACE)
-- =============================================================

-- vehicle_capacity_at: 시간 단위 점유 모델
CREATE OR REPLACE FUNCTION vehicle_capacity_at(
  p_date DATE, p_hour INT, p_origin TEXT, p_vehicle_id INT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path = public
AS $$
DECLARE
  v_run_total INT;
  v_other_count INT;
BEGIN
  -- (1) 같은 차량·시각·출발지역의 활성 예약 인원 합 = 합승 잔여 계산용
  SELECT COALESCE(SUM(r.persons), 0) INTO v_run_total
  FROM reservations r
  JOIN locations dep ON dep.id = r.departure_location_id
  WHERE r.vehicle_id = p_vehicle_id
    AND r.reservation_date = p_date
    AND r.hour = p_hour
    AND r.status IN ('waiting', 'confirmed')
    AND dep.category = p_origin;

  IF v_run_total > 0 THEN
    RETURN GREATEST(0, 4 - v_run_total); -- 합승 잔여석
  END IF;

  -- (2) 같은 차량·시각이지만 출발지역이 다른 활성 예약이 있으면 차는 그 시간 다른 방향 운행 중
  SELECT COUNT(*) INTO v_other_count
  FROM reservations r
  JOIN locations dep ON dep.id = r.departure_location_id
  WHERE r.vehicle_id = p_vehicle_id
    AND r.reservation_date = p_date
    AND r.hour = p_hour
    AND r.status IN ('waiting', 'confirmed')
    AND dep.category <> p_origin;

  IF v_other_count > 0 THEN RETURN 0; END IF;

  -- (3) 그 시간에 차의 운행이 전혀 없음 → 새 운행 가능(4석)
  RETURN 4;
END;
$$;

-- assign_vehicle: 합승 우선(A→B) → 빈 차량(A→B). 1시간 사이클 모델.
CREATE OR REPLACE FUNCTION assign_vehicle(
  p_date DATE, p_hour INT, p_origin TEXT, p_persons INT
) RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v RECORD;
  v_total INT;
BEGIN
  -- 우선순위 1: 합승 (기존 같은 방향 운행에 합류, A 먼저)
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

  -- 우선순위 2: 빈 차량 (그 시간 운행 없는 차, A 먼저)
  FOR v IN SELECT id FROM vehicles WHERE is_active ORDER BY code LOOP
    IF p_persons <= 4 AND vehicle_capacity_at(p_date, p_hour, p_origin, v.id) = 4 THEN
      RETURN v.id;
    END IF;
  END LOOP;

  RETURN NULL;
END;
$$;

-- merge_reservations_admin: 새 시각에 다른 운행 없는 빈 차량 (선택된 예약 제외) 으로 배정
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
  v_date DATE; v_dep_cat TEXT;
  v_vehicle_id INT; v RECORD; v_conflict INT;
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

  -- 차량 배정: 새 시각에 다른 운행이 없는 차량 (선택된 예약은 매트릭스에서 제외)
  FOR v IN SELECT id FROM vehicles WHERE is_active ORDER BY code LOOP
    SELECT COUNT(*) INTO v_conflict
    FROM reservations r
    WHERE r.vehicle_id = v.id
      AND r.reservation_date = v_date
      AND r.hour = p_new_hour
      AND r.status IN ('waiting', 'confirmed')
      AND NOT (r.id = ANY(p_reservation_ids));
    IF v_conflict = 0 THEN v_vehicle_id := v.id; EXIT; END IF;
  END LOOP;

  IF v_vehicle_id IS NULL THEN RAISE EXCEPTION 'NO_VEHICLE'; END IF;

  -- 한도 검사 (운행 횟수 기준 — 기존 동일)
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
