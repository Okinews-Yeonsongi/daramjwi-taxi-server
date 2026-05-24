-- =============================================================
-- 0005 전화(비회원) 예약 지원
--  - 이장님이 전화로 받은 신청을 "이름+전화"만으로 대신 예약 (계정/프로필 없이)
--  - 주민 정보는 저장하지 않음 (매번 입력)
--  - 멱등(여러 번 실행 안전)
-- =============================================================

-- 회원 예약은 user_id, 전화예약은 guest_name+guest_phone 사용
ALTER TABLE reservations ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS guest_name VARCHAR(50);
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS guest_phone VARCHAR(20);

-- 둘 중 하나는 반드시 있어야 함
ALTER TABLE reservations DROP CONSTRAINT IF EXISTS chk_reservation_owner;
ALTER TABLE reservations ADD CONSTRAINT chk_reservation_owner
  CHECK (user_id IS NOT NULL OR (guest_name IS NOT NULL AND guest_phone IS NOT NULL));

-- 전화예약 조회용 인덱스 (사람별 월 이용횟수 집계)
CREATE INDEX IF NOT EXISTS idx_reservations_guest_phone
  ON reservations(guest_phone) WHERE guest_phone IS NOT NULL;

-- 전화(비회원) 예약 생성 — 관리자(service_role) 전용. 매트릭스/동시성은 회원 예약과 동일.
CREATE OR REPLACE FUNCTION create_guest_reservation_atomic(
  p_guest_name TEXT, p_guest_phone TEXT, p_date DATE, p_hour INT,
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
  PERFORM pg_advisory_xact_lock(hashtext('daramjwi_reservation'), hashtext(p_date::text));

  IF p_guest_name IS NULL OR length(trim(p_guest_name)) = 0
     OR p_guest_phone IS NULL OR length(trim(p_guest_phone)) = 0 THEN
    RAISE EXCEPTION 'INVALID_GUEST';
  END IF;
  IF p_persons < 1 OR p_persons > 4 THEN RAISE EXCEPTION 'INVALID_PERSONS'; END IF;
  IF p_hour < 9 OR p_hour > 18 THEN RAISE EXCEPTION 'INVALID_HOUR'; END IF;

  SELECT category INTO v_dep_cat FROM locations WHERE id = p_departure_id AND is_active;
  SELECT category INTO v_arr_cat FROM locations WHERE id = p_arrival_id AND is_active;
  IF v_dep_cat IS NULL OR v_arr_cat IS NULL THEN RAISE EXCEPTION 'INVALID_LOCATION'; END IF;
  IF v_dep_cat = v_arr_cat THEN RAISE EXCEPTION 'SAME_CATEGORY'; END IF;

  v_vehicle_id := assign_vehicle(p_date, p_hour, v_dep_cat, p_persons);
  IF v_vehicle_id IS NULL THEN RAISE EXCEPTION 'NO_VEHICLE'; END IF;

  INSERT INTO reservations
    (user_id, guest_name, guest_phone, reservation_date, hour, persons,
     departure_location_id, arrival_location_id, vehicle_id, status)
  VALUES
    (NULL, trim(p_guest_name), trim(p_guest_phone), p_date, p_hour, p_persons,
     p_departure_id, p_arrival_id, v_vehicle_id, 'waiting')
  RETURNING * INTO v_new;

  RETURN v_new;
END;
$$;

-- 관리자(service_role)만 호출 가능하도록 제한
REVOKE EXECUTE ON FUNCTION create_guest_reservation_atomic(TEXT, TEXT, DATE, INT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_guest_reservation_atomic(TEXT, TEXT, DATE, INT, INT, INT, INT) TO service_role;
