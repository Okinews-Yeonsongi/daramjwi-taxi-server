import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/user";
import { json, apiError } from "@/lib/api/http";
import { kstTodayString } from "@/lib/api/time";
import { FARE_WON, DAILY_LIMIT, MONTHLY_LIMIT } from "@/lib/constants";
import { confirmedStats, monthBounds } from "@/lib/api/admin";

/**
 * GET /api/stats/village   🔒
 * 마을 현황: 운행 한도(일/월) + 탑승 인원 + 평균 탑승자.
 * - daily.used / monthly.used = 확정 운행 횟수(합승 1회)
 * - monthly.passengers       = 이번 달 확정 예약 인원 총합 (합승 포함)
 * - monthly.avg_passengers_per_run = passengers / runs (소수점 1자리)
 */
export async function GET(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const today = kstTodayString();
  const { start, nextStart } = monthBounds(today);
  const admin = createAdminClient();

  let daily = { runs: 0, passengers: 0 };
  let monthly = { runs: 0, passengers: 0 };
  try {
    [daily, monthly] = await Promise.all([
      confirmedStats(admin, { date: today }),
      confirmedStats(admin, { start, nextStart }),
    ]);
  } catch (e) {
    console.error("[stats/village] 조회 실패:", (e as Error).message);
    return apiError("마을 현황을 불러오지 못했어요.", 500);
  }

  const avg = monthly.runs > 0 ? Math.round((monthly.passengers / monthly.runs) * 10) / 10 : 0;

  return json({
    date: today,
    fare: FARE_WON,
    daily: {
      used: daily.runs,
      limit: DAILY_LIMIT,
      remaining: Math.max(0, DAILY_LIMIT - daily.runs),
    },
    monthly: {
      used: monthly.runs,
      limit: MONTHLY_LIMIT,
      remaining: Math.max(0, MONTHLY_LIMIT - monthly.runs),
      passengers: monthly.passengers,
      avg_passengers_per_run: avg,
    },
  });
}
