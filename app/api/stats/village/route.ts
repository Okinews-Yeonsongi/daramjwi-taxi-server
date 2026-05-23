import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/user";
import { json, apiError } from "@/lib/api/http";
import { kstTodayString } from "@/lib/api/time";
import { FARE_WON, DAILY_LIMIT, MONTHLY_LIMIT } from "@/lib/constants";
import { countConfirmedRuns, monthBounds } from "@/lib/api/admin";

/**
 * GET /api/stats/village   🔒
 * 마을 현황: 오늘/이번달 확정 "운행 횟수", 잔여 한도, 요금.
 * 한도는 운행(차 출발) 수 기준 — 합승은 1회로 계산. (확정된 것만)
 *
 * 응답: { date, fare, daily: {used,limit,remaining}, monthly: {used,limit,remaining} }
 */
export async function GET(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const today = kstTodayString();
  const { start, nextStart } = monthBounds(today);
  const admin = createAdminClient();

  let dailyUsed = 0;
  let monthlyUsed = 0;
  try {
    [dailyUsed, monthlyUsed] = await Promise.all([
      countConfirmedRuns(admin, { date: today }),
      countConfirmedRuns(admin, { start, nextStart }),
    ]);
  } catch (e) {
    console.error("[stats/village] 조회 실패:", (e as Error).message);
    return apiError("마을 현황을 불러오지 못했어요.", 500);
  }

  return json({
    date: today,
    fare: FARE_WON,
    daily: { used: dailyUsed, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - dailyUsed) },
    monthly: { used: monthlyUsed, limit: MONTHLY_LIMIT, remaining: Math.max(0, MONTHLY_LIMIT - monthlyUsed) },
  });
}
