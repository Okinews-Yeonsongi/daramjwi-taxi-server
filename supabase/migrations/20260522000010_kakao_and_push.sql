-- =============================================================
-- 0010 카카오 로그인 + 웹 푸시 인프라
--  - profiles: kakao_id / kakao_nickname / kakao_profile_image 컬럼 추가
--  - push_subscriptions: 사용자별 푸시 구독 (브라우저당 1개)
--  - 멱등 (IF NOT EXISTS / DROP IF EXISTS)
-- =============================================================

-- profiles 확장
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kakao_id TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kakao_nickname TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kakao_profile_image TEXT;

-- 카카오 ID 유니크 인덱스 (NULL은 허용, 같은 카카오 계정 중복 가입 방지)
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_kakao_id ON profiles(kakao_id) WHERE kakao_id IS NOT NULL;

-- 푸시 구독 테이블
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- RLS: 본인 구독만 보고/지움. 발송은 service_role이 하므로 SELECT/DELETE만 사용자에게.
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subs_select_own ON push_subscriptions;
CREATE POLICY push_subs_select_own ON push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subs_insert_own ON push_subscriptions;
CREATE POLICY push_subs_insert_own ON push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subs_delete_own ON push_subscriptions;
CREATE POLICY push_subs_delete_own ON push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);
