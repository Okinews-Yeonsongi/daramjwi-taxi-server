-- =============================================================
-- 0013 create_guest_reservation_atomic — is_admin() 체크 제거
--  - 0012에서 추가한 is_admin() 체크가 service_role 호출 시 auth.uid() = NULL → false 반환
--  - 결과: 모든 전화 신청 실패 (FORBIDDEN)
--  - 권한 체크는 이미 API 라우트의 requireAdmin 에서 하므로 함수 내 중복 체크 제거
--  - 멱등 (CREATE OR REPLACE)
-- =============================================================

CREATE OR REPLACE FUNCTION create_guest_reservation_atomic(
  p_guest_name TEXT,
  p_guest_phone TEXT,
  p_date DATE,
  p_hour INT,
  p_departure_id INT,
  p_arrival_id INT,
  p_persons INT,
  p_user_id UUID DEFAULT NULL
) RETURNS reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dep_cat TEXT;
  v_arr_cat TEXT;
  v_vehicle_id INT;
  v_new reservations;
BEGIN
  -- 권한 체크는 API 라우트의 requireAdmin 이 담당. 여기선 입력값만 검증.

  PERFORM pg_advisory_xact_lock(hashtext('daramjwi_reservation'), hashtext(p_date::text));

  IF coalesce(trim(p_guest_name), '') = '' OR coalesce(trim(p_guest_phone), '') = '' THEN
    RAISE EXCEPTION 'INVALID_GUEST';
  END IF;
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

  INSERT INTO reservations (
    user_id, guest_name, guest_phone,
    reservation_date, hour, persons,
    departure_location_id, arrival_location_id,
    vehicle_id, status
  ) VALUES (
    p_user_id,
    CASE WHEN p_user_id IS NULL THEN p_guest_name ELSE NULL END,
    CASE WHEN p_user_id IS NULL THEN p_guest_phone ELSE NULL END,
    p_date, p_hour, p_persons,
    p_departure_id, p_arrival_id,
    v_vehicle_id, 'waiting'
  ) RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

REVOKE EXECUTE ON FUNCTION create_guest_reservation_atomic(TEXT, TEXT, DATE, INT, INT, INT, INT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_guest_reservation_atomic(TEXT, TEXT, DATE, INT, INT, INT, INT, UUID) TO authenticated, service_role;
