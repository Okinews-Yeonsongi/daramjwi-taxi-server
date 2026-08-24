-- =============================================================
-- 0016 운행 이력 (GPS) + 영수증 사진 + 정산 금액
--  - trip_started_at / trip_ended_at: 실제 운행 시각 (기사님이 앱에서 시작·도착 버튼 누른 시점)
--  - GPS 좌표: 출발·도착 지점 (실제 위치 기록용)
--  - fare_amount: 기사님이 입력한 정산 금액 (원 단위)
--  - receipt_image_path: Supabase Storage의 영수증 사진 경로 (행정팀 참고용)
-- =============================================================

ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS trip_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trip_start_lat NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS trip_start_lng NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS trip_ended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trip_end_lat NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS trip_end_lng NUMERIC(9,6),
  ADD COLUMN IF NOT EXISTS fare_amount INT,
  ADD COLUMN IF NOT EXISTS receipt_image_path TEXT;

-- 정산·통계 인덱스 (월별 조회용)
CREATE INDEX IF NOT EXISTS idx_reservations_trip_ended
  ON reservations(trip_ended_at)
  WHERE trip_ended_at IS NOT NULL;

-- 스토리지 버킷 (사장님이 Supabase 대시보드 Storage에서 수동 생성 필요):
--   Bucket 이름: "receipts"
--   Public: OFF (인증 필요)
--   File size limit: 5 MB
--   Allowed MIME types: image/jpeg, image/png, image/webp
--
-- 그 후 아래 정책으로 admin만 업로드/조회 가능하게:
--   INSERT INTO storage.policies ... (아래는 참고용 SQL. 대시보드 UI에서도 가능)

-- Storage RLS (buckets.name='receipts')
-- admin만 upload / read
DROP POLICY IF EXISTS receipts_admin_all ON storage.objects;
CREATE POLICY receipts_admin_all ON storage.objects
  FOR ALL
  TO authenticated
  USING (
    bucket_id = 'receipts'
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    bucket_id = 'receipts'
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
