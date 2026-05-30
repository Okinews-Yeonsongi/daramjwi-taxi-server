-- =============================================================
-- 0006 예약 실시간 동기화 활성화 (Supabase Realtime)
--  - 주민이 신청/취소하는 순간 기사님 앱(구독자)에게 즉시 푸시
--  - RLS는 그대로 적용됨 → 주민은 본인 것만, 기사님(is_admin)은 전체 수신
--  - 멱등(여러 번 실행 안전)
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'reservations'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.reservations;
  END IF;
END $$;
