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

  // 담당 차량 번호판 (기사님이 vehicle_id 있으면)
  let vehiclePlate: string | null = null;
  if (profile?.vehicle_id) {
    const { data: v } = await auth.supabase
      .from("vehicles")
      .select("plate_number")
      .eq("id", profile.vehicle_id)
      .maybeSingle();
    vehiclePlate = v?.plate_number ?? null;
  }

  return json({
    user: { id: auth.user.id, phone: authPhoneToLocal(auth.user.phone) },
    profile: profile ? { ...profile, vehicle_plate: vehiclePlate } : null,
    needsOnboarding: !profile,
  });
}
