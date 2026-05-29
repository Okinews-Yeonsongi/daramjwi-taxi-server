import { json, apiError } from "@/lib/api/http";

/**
 * GET /api/dev/config   ⚠️ 개발 전용 (ENABLE_DEV_LOGIN=true 일 때만)
 * 테스트 콘솔이 카카오 OAuth를 쓰려면 공개키(URL/anon)가 필요해서 내려줍니다.
 * (둘 다 공개 가능한 값 — anon/publishable 키)
 */
const ENABLED = process.env.ENABLE_DEV_LOGIN === "true";

export async function GET() {
  if (!ENABLED) return apiError("개발용 설정이 비활성화돼 있어요.", 404);
  return json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
}
