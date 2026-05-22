import { requireAdmin, monthBounds } from "@/lib/api/admin";
import { json, apiError } from "@/lib/api/http";
import { kstTodayString } from "@/lib/api/time";
import { DAILY_LIMIT, MONTHLY_LIMIT, FARE_WON } from "@/lib/constants";

/**
 * GET /api/admin/dashboard   🔒(admin)
 * 오늘 요약: 상태별 건수, 확정 인원, 일/월 한도 사용량.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { db } = guard;

  const today = kstTodayString();
  const { start, nextStart } = monthBounds(today);

  const [todayRes, monthConf] = await Promise.all([
    db.from("reservations").select("status, persons").eq("reservation_date", today),
    db.from("reservations").select("*", { count: "exact", head: true }).eq("status", "confirmed").gte("reservation_date", start).lt("reservation_date", nextStart),
  ]);

  if (todayRes.error) {
    console.error("[admin dashboard] 조회 실패:", todayRes.error.message);
    return apiError("대시보드를 불러오지 못했어요.", 500);
  }

  const counts = { waiting: 0, confirmed: 0, cancelled: 0, completed: 0 };
  let confirmedPersons = 0;
  for (const r of todayRes.data ?? []) {
    if (r.status in counts) counts[r.status as keyof typeof counts] += 1;
    if (r.status === "confirmed") confirmedPersons += r.persons;
  }

  const monthlyUsed = monthConf.count ?? 0;

  return json({
    date: today,
    fare: FARE_WON,
    today: { ...counts, confirmed_persons: confirmedPersons },
    limits: {
      daily: { used: counts.confirmed, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - counts.confirmed) },
      monthly: { used: monthlyUsed, limit: MONTHLY_LIMIT, remaining: Math.max(0, MONTHLY_LIMIT - monthlyUsed) },
    },
  });
}
