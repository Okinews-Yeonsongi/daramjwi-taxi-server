import { json } from "@/lib/api/http";

/**
 * GET /api/debug/env-check
 * 환경변수가 정확히 설정됐는지 점검 (값은 노출 안 함, 길이·앞뒤·체크섬만).
 * 디버깅 끝나면 삭제할 것.
 */
export async function GET() {
  const inspect = (key: string, value?: string) => {
    if (value === undefined) return { exists: false };
    return {
      exists: true,
      length: value.length,
      first_3: value.slice(0, 3),
      last_3: value.slice(-3),
      starts_with_whitespace: /^\s/.test(value),
      ends_with_whitespace: /\s$/.test(value),
      has_tab: value.includes("\t"),
      has_newline: /[\r\n]/.test(value),
      contains_quotes: /["']/.test(value),
    };
  };

  return json({
    KAKAO_REST_API_KEY: inspect("KAKAO_REST_API_KEY", process.env.KAKAO_REST_API_KEY),
    KAKAO_REDIRECT_URI: {
      ...inspect("KAKAO_REDIRECT_URI", process.env.KAKAO_REDIRECT_URI),
      value: process.env.KAKAO_REDIRECT_URI ?? null, // URI는 공개 정보라 그대로 보임
    },
    VAPID_PUBLIC_KEY: inspect("VAPID_PUBLIC_KEY", process.env.VAPID_PUBLIC_KEY),
    VAPID_PRIVATE_KEY: inspect("VAPID_PRIVATE_KEY", process.env.VAPID_PRIVATE_KEY),
    VAPID_SUBJECT: {
      ...inspect("VAPID_SUBJECT", process.env.VAPID_SUBJECT),
      value: process.env.VAPID_SUBJECT ?? null,
    },
    INTERNAL_PASSWORD_SECRET: inspect("INTERNAL_PASSWORD_SECRET", process.env.INTERNAL_PASSWORD_SECRET),
    SUPABASE_SERVICE_ROLE_KEY: inspect("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY),
    expected_kakao_key_length: 32,
    expected_kakao_key_first_3: "c99",
    expected_kakao_key_last_3: "7a0",
  });
}
