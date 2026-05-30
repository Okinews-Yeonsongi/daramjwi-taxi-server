-- =============================================================
-- 0007 합치기(기사님 수동 조율) 지원
--  - departure_minute: 출발 시각의 분(10분 단위). 일반 예약은 0, 합치기 시만 변경.
--  - merge_reservations_admin: 선택된 대기 예약 N건을 같은 차/같은 시각으로 묶어 자동 확정.
--    조건: 모두 waiting / 같은 날짜 / 같은 출발지역 / 시간차 ≤ 1시간 / 인원합 ≤ 4.
--    한도(일 4회/월 112회) 검사 포함. 멱등(여러 번 실행 안전).
-- =============================================================

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS departure_minute INT NOT NULL DEFAULT 0;

ALTER TABLE reservations DROP CONSTRAINT IF EXISTS chk_reservation_minute;
ALTER TABLE reservations ADD CONSTRAINT chk_reservation_minute
  CHECK (departure_minute IN (0, 10, 20, 30, 40, 50));

-- 합치기 함수 (기사님 / service_role 전용)
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
  v_vehicle_id INT; v_v RECORD; v_conflict INT;
  v_month_start DATE; v_next_month DATE;
  v_daily_runs INT; v_monthly_runs INT;
BEGIN
  -- 기본 파라미터 검증
  IF p_reservation_ids IS NULL OR array_length(p_reservation_ids, 1) < 2 THEN
    RAISE EXCEPTION 'MERGE_NEED_TWO';
  END IF;
  IF p_new_hour < 9 OR p_new_hour > 18 THEN RAISE EXCEPTION 'INVALID_HOUR'; END IF;
  IF p_new_minute NOT IN (0, 10, 20, 30, 40, 50) THEN RAISE EXCEPTION 'INVALID_MINUTE'; END IF;

  -- 선택 예약들의 일관성 검증 (모두 waiting / 같은 날짜 / 같은 출발 카테고리 / 시간차 ≤1 / 인원합 ≤4)
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

  -- 동시 작업 직렬화
  PERFORM pg_advisory_xact_lock(hashtext('daramjwi_reservation'), hashtext(v_date::text));

  v_arrival := CASE WHEN v_dep_cat = 'cheongsanmyeon' THEN 'eupnae' ELSE 'cheongsanmyeon' END;

  -- 차량 배정: 새 시간에 빈 차량(선택 예약들은 매트릭스에서 제외하고 검사). A 우선
  FOR v_v IN SELECT id FROM vehicles WHERE is_active ORDER BY code LOOP
    SELECT COUNT(*) INTO v_conflict
    FROM blocked_cells(v_dep_cat, v_arrival, p_new_hour) needed
    WHERE EXISTS (
      SELECT 1
      FROM reservations r
      JOIN locations dep ON dep.id = r.departure_location_id
      JOIN locations arr ON arr.id = r.arrival_location_id
      CROSS JOIN LATERAL blocked_cells(dep.category, arr.category, r.hour) bc
      WHERE r.vehicle_id = v_v.id
        AND r.reservation_date = v_date
        AND r.status IN ('waiting', 'confirmed')
        AND NOT (r.id = ANY(p_reservation_ids))
        AND bc.category = needed.category
        AND bc.hour = needed.hour
    );
    IF v_conflict = 0 THEN v_vehicle_id := v_v.id; EXIT; END IF;
  END LOOP;

  IF v_vehicle_id IS NULL THEN RAISE EXCEPTION 'NO_VEHICLE'; END IF;

  -- 운행 한도(일 4/월 112) 검사 — 합쳐서 새 운행 1개 추가됨
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

  -- 선택 예약을 같은 차/새 시간/확정으로 업데이트
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
