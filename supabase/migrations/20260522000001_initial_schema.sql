-- =============================================================
-- 0001 초기 스키마 (PROJECT_SPEC.md 5.2 DDL 그대로)
-- =============================================================

-- 1. 프로필
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  phone VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(50) NOT NULL,
  address TEXT,
  role VARCHAR(20) NOT NULL DEFAULT 'resident' CHECK (role IN ('resident', 'admin')),
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_profiles_phone ON profiles(phone);
CREATE INDEX idx_profiles_role ON profiles(role);

-- 2. 차량
CREATE TABLE vehicles (
  id SERIAL PRIMARY KEY,
  code VARCHAR(2) NOT NULL UNIQUE CHECK (code IN ('A', 'B')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
INSERT INTO vehicles (code) VALUES ('A'), ('B');

-- 3. 장소
CREATE TABLE locations (
  id SERIAL PRIMARY KEY,
  category VARCHAR(20) NOT NULL CHECK (category IN ('cheongsanmyeon', 'eupnae')),
  name VARCHAR(50) NOT NULL,
  emoji VARCHAR(8),
  display_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);
CREATE INDEX idx_locations_category ON locations(category, display_order);
INSERT INTO locations (category, name, emoji, display_order) VALUES
  ('cheongsanmyeon', '우리집', '🏠', 1),
  ('cheongsanmyeon', '마을회관', '🏛', 2),
  ('cheongsanmyeon', '청산면사무소', '🏢', 3),
  ('eupnae', '옥천성모병원', '🏥', 1),
  ('eupnae', '옥천군청', '🏛', 2),
  ('eupnae', '시장', '🛒', 3);

-- 4. 시간 슬롯
CREATE TABLE time_slots (
  hour INT PRIMARY KEY CHECK (hour BETWEEN 9 AND 18),
  label VARCHAR(20) NOT NULL
);
INSERT INTO time_slots (hour, label) VALUES
  (9, '오전 9시'), (10, '오전 10시'), (11, '오전 11시'),
  (12, '오후 12시'), (13, '오후 1시'), (14, '오후 2시'),
  (15, '오후 3시'), (16, '오후 4시'), (17, '오후 5시'), (18, '오후 6시');

-- 5. 예약
CREATE TABLE reservations (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reservation_date DATE NOT NULL,
  hour INT NOT NULL REFERENCES time_slots(hour),
  persons INT NOT NULL CHECK (persons BETWEEN 1 AND 4),
  departure_location_id INT NOT NULL REFERENCES locations(id),
  arrival_location_id INT NOT NULL REFERENCES locations(id),
  vehicle_id INT REFERENCES vehicles(id),
  status VARCHAR(20) NOT NULL DEFAULT 'waiting'
    CHECK (status IN ('waiting', 'confirmed', 'cancelled', 'completed')),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES profiles(id),
  cancel_reason TEXT,
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (departure_location_id <> arrival_location_id)
);
CREATE INDEX idx_reservations_user ON reservations(user_id, created_at DESC);
CREATE INDEX idx_reservations_date_active
  ON reservations(reservation_date, hour)
  WHERE status IN ('waiting', 'confirmed');
CREATE INDEX idx_reservations_status ON reservations(status);

-- 6. 매트릭스 계산 헬퍼 뷰 (옵션)
CREATE OR REPLACE VIEW v_active_reservations AS
SELECT
  r.id, r.reservation_date, r.hour, r.vehicle_id, r.persons,
  dep.category AS departure_category,
  arr.category AS arrival_category,
  v.code AS vehicle_code
FROM reservations r
JOIN locations dep ON dep.id = r.departure_location_id
JOIN locations arr ON arr.id = r.arrival_location_id
JOIN vehicles v ON v.id = r.vehicle_id
WHERE r.status IN ('waiting', 'confirmed');
