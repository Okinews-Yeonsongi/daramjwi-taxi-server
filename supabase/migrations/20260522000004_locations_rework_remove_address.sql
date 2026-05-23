-- =============================================================
-- 0004 청산면 장소를 '마을 거점'으로 재분류 + 집주소 컬럼 제거
--  - 픽업/드랍은 마을 거점만 가능 (개인 집 주소 사용 안 함)
--  - 기존 location id(1,2,3)를 재사용해 예약 FK 무결성 유지
--  - id 기준이라 여러 번 실행해도 안전(멱등)
-- =============================================================

-- 청산면(기존 id 1,2,3) 거점으로 변경
UPDATE locations SET name = '청산면사무소',  emoji = '🏢', display_order = 1 WHERE id = 1; -- 기존 '우리집'
UPDATE locations SET name = '백운리마을회관', emoji = '🏛', display_order = 2 WHERE id = 2; -- 기존 '마을회관'
UPDATE locations SET name = '백운사',        emoji = '🏯', display_order = 3 WHERE id = 3; -- 기존 '청산면사무소'

-- 청산고등학교 추가 (없을 때만)
INSERT INTO locations (category, name, emoji, display_order, is_active)
SELECT 'cheongsanmyeon', '청산고등학교', '🏫', 4, true
WHERE NOT EXISTS (
  SELECT 1 FROM locations WHERE category = 'cheongsanmyeon' AND name = '청산고등학교'
);

-- 읍내(id 4,5,6: 옥천성모병원/옥천군청/시장)는 그대로 둡니다.

-- 집 주소 컬럼 제거 (거점 픽업/드랍만 하므로 불필요)
ALTER TABLE profiles DROP COLUMN IF EXISTS address;
