import { requireAdmin, monthBounds, countConfirmedRuns } from "@/lib/api/admin";
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
  const { db, vehicleId } = guard;

  const today = kstTodayString();
  const { start, nextStart } = monthBounds(today);

  // 담당 차량 있는 기사님은 자기 차량 예약 + 미배정만 봄, NULL 기사님은 전체
  let todayQ = db.from("reservations").select("status, persons, vehicle_id").eq("reservation_date", today);
  if (vehicleId != null) todayQ = todayQ.or(`vehicle_id.eq.${vehicleId},vehicle_id.is.null`);
  const todayRes = await todayQ;
  if (todayRes.error) {
    console.error("[admin dashboard] 조회 실패:", todayRes.error.message);
    return apiError("대시보드를 불러오지 못했어요.", 500);
  }

  // 오늘 상태별 "건수"(예약 수)
  const counts = { waiting: 0, confirmed: 0, cancelled: 0, completed: 0 };
  let confirmedPersons = 0;
  for (const r of todayRes.data ?? []) {
    if (r.status in counts) counts[r.status as keyof typeof counts] += 1;
    if (r.status === "confirmed") confirmedPersons += r.persons;
  }

  // 오늘 이후(미래 포함) 대기 건수 — 담당 차량 기준
  let pendingQ = db
    .from("reservations")
    .select("id", { count: "exact", head: true })
    .eq("status", "waiting")
    .gte("reservation_date", today);
  if (vehicleId != null) pendingQ = pendingQ.or(`vehicle_id.eq.${vehicleId},vehicle_id.is.null`);
  const pendingRes = await pendingQ;
  const pendingTotal = pendingRes.count ?? 0;

  // 한도는 "운행 횟수" 기준 (합승 1회)
  let dailyRuns = 0;
  let monthlyRuns = 0;
  try {
    [dailyRuns, monthlyRuns] = await Promise.all([
      countConfirmedRuns(db, { date: today }),
      countConfirmedRuns(db, { start, nextStart }),
    ]);
  } catch (e) {
    console.error("[admin dashboard] 운행수 집계 실패:", (e as Error).message);
    return apiError("대시보드를 불러오지 못했어요.", 500);
  }

  return json({
    date: today,
    fare: FARE_WON,
    today: { ...counts, confirmed_persons: confirmedPersons }, // 오늘 예약 건수 기준
    pending_total: pendingTotal, // 오늘 이후 모든 미처리 대기 건수
    limits: {
      daily: { used: dailyRuns, limit: DAILY_LIMIT, remaining: Math.max(0, DAILY_LIMIT - dailyRuns) },
      monthly: { used: monthlyRuns, limit: MONTHLY_LIMIT, remaining: Math.max(0, MONTHLY_LIMIT - monthlyRuns) },
    },
  });
}
