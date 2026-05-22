import { getAuthUser } from "@/lib/supabase/user";
import { json, apiError } from "@/lib/api/http";
import { authPhoneToLocal } from "@/lib/api/phone";

/**
 * GET /api/auth/me   (헤더: Authorization: Bearer <access_token>)
 * → 현재 로그인한 사용자 정보 + 프로필.
 */
export async function GET(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const { data: profile } = await auth.supabase
    .from("profiles")
    .select("*")
    .eq("id", auth.user.id)
    .maybeSingle();

  return json({
    user: { id: auth.user.id, phone: authPhoneToLocal(auth.user.phone) },
    profile: profile ?? null,
    needsOnboarding: !profile,
  });
}
