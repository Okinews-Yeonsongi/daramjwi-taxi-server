-- =============================================================
-- 0011 매트릭스에 일/월 운행 한도 반영
--  - 기존: 한도(일 4회/월 112회) 검사는 '확정' 시점에만 → 신청은 통과되고 확정 시 거부 (UX 나쁨)
--  - 수정: vehicle_capacity_at에서 "새 운행" 가능 케이스 직전 한도 체크 추가
--  - 합승은 한도 영향 X (운행 수 안 늘림) → 잔여석 그대로
--  - 빈 차량 새 운행은 한도 도달 시 0 반환 → 매트릭스 마감 표시
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
  v_daily_runs INT;
  v_monthly_runs INT;
  v_month_start DATE;
  v_next_month DATE;
BEGIN
  v_arrival := CASE WHEN p_origin = 'cheongsanmyeon' THEN 'eupnae' ELSE 'cheongsanmyeon' END;

  -- (1) 같은 V·시각·같은 방향: 합승 잔여 (한도 영향 X — 운행 수 안 늘림)
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

  -- (4) 다음 운행과 위치 호환성
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

  -- (5) 일 한도 검사 — 새 운행(빈 차량 사용)이 한도 초과하지 않는지
  --     확정된 운행이 4회 차면 더 이상 새 운행 불가 (합승은 위에서 통과)
  SELECT COUNT(*) INTO v_daily_runs FROM (
    SELECT DISTINCT reservation_date, hour, vehicle_id FROM reservations
    WHERE status = 'confirmed' AND reservation_date = p_date
  ) t;
  IF v_daily_runs >= 4 THEN
    RETURN 0;
  END IF;

  -- (6) 월 한도 검사
  v_month_start := date_trunc('month', p_date)::date;
  v_next_month := (date_trunc('month', p_date) + INTERVAL '1 month')::date;
  SELECT COUNT(*) INTO v_monthly_runs FROM (
    SELECT DISTINCT reservation_date, hour, vehicle_id FROM reservations
    WHERE status = 'confirmed'
      AND reservation_date >= v_month_start AND reservation_date < v_next_month
  ) t;
  IF v_monthly_runs >= 112 THEN
    RETURN 0;
  END IF;

  RETURN 4;
END;
$$;
