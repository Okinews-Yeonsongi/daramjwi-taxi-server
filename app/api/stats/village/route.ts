import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/user";
import { json, apiError } from "@/lib/api/http";
import { kstTodayString } from "@/lib/api/time";
import { FARE_WON, DAILY_LIMIT, MONTHLY_LIMIT } from "@/lib/constants";

/**
 * GET /api/stats/village   🔒
 * 마을 현황: 오늘/이번달 확정 누적, 잔여 한도, 요금. (모두 confirmed 기준, 마을 전체)
 *
 * 응답: { date, fare, daily: {used,limit,remaining}, monthly: {used,limit,remaining} }
 */
export async function GET(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const today = kstTodayString();
  const [y, mo] = today.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStart = `${y}-${pad(mo)}-01`;
  const nextY = mo === 12 ? y + 1 : y;
  const nextMo = mo === 12 ? 1 : mo + 1;
  const nextMonthStart = `${nextY}-${pad(nextMo)}-01`;

  const admin = createAdminClient();
  const [todayRes, monthRes] = await Promise.all([
    admin
      .from("reservations")
      .select("*", { count: "exact", head: true })
      .eq("status", "confirmed")
      .eq("reservation_date", today),
    admin
      .from("reservations")
      .select("*", { count: "exact", head: true })
      .eq("status", "confirmed")
      .gte("reservation_date", monthStart)
      .lt("reservation_date", nextMonthStart),
  ]);

  if (todayRes.error || monthRes.error) {
    console.error("[stats/village] 조회 실패:", todayRes.error?.message || monthRes.error?.message);
    return apiError("마을 현황을 불러오지 못했어요.", 500);
  }

  const todayUsed = todayRes.count ?? 0;
  const monthUsed = monthRes.count ?? 0;

  return json({
    date: today,
    fare: FARE_WON,
    daily: { used: todayUsed, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - todayUsed) },
    monthly: { used: monthUsed, limit: MONTHLY_LIMIT, remaining: Math.max(0, MONTHLY_LIMIT - monthUsed) },
  });
}
