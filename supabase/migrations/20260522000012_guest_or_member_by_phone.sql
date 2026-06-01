-- =============================================================
-- 0012 전화 신청 시 회원 자동 매칭
--  - create_guest_reservation_atomic 에 p_user_id 옵션 인자 추가
--  - 기사님이 전화로 받은 신청을 입력할 때, 전화번호 매칭되는 회원 있으면
--    그 user_id 를 같이 전달 → 회원 예약으로 저장 (본인 "내 예약"에 표시됨)
--  - 매칭 안 되면 기존대로 guest 예약 (user_id=NULL)
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
  p_user_id UUID DEFAULT NULL  -- 옵션: 매칭된 회원의 user_id (있으면 회원 예약)
) RETURNS reservations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_dep_cat TEXT;
  v_arr_cat TEXT;
  v_vehicle_id INT;
  v_new reservations;
BEGIN
  -- admin 권한만 호출 가능 (기사님 전용)
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

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
    p_user_id,  -- 회원 매칭 있으면 그 값, 없으면 NULL
    CASE WHEN p_user_id IS NULL THEN p_guest_name ELSE NULL END,  -- 회원이면 guest_name 비움
    CASE WHEN p_user_id IS NULL THEN p_guest_phone ELSE NULL END, -- 회원이면 guest_phone 비움
    p_date, p_hour, p_persons,
    p_departure_id, p_arrival_id,
    v_vehicle_id, 'waiting'
  ) RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

-- 권한 (admin role 사용자만 호출, 함수 내부에서도 is_admin() 체크)
REVOKE EXECUTE ON FUNCTION create_guest_reservation_atomic(TEXT, TEXT, DATE, INT, INT, INT, INT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_guest_reservation_atomic(TEXT, TEXT, DATE, INT, INT, INT, INT, UUID) TO authenticated, service_role;
