import { requireAdmin, monthBounds } from "@/lib/api/admin";
import { json, apiError } from "@/lib/api/http";
import { kstTodayString } from "@/lib/api/time";

/**
 * GET /api/admin/stats?month=YYYY-MM   🔒(admin)
 * 월 통계: 상태별 예약 건수, 확정 인원 합, 확정 "운행 횟수"(합승 1회), 일자별 운행 횟수.
 * month 생략 시 이번 달.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { db } = guard;

  const url = new URL(request.url);
  const monthParam = url.searchParams.get("month");
  const month = monthParam ?? kstTodayString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return apiError("month 형식은 YYYY-MM 이에요.", 400);

  const { start, nextStart } = monthBounds(`${month}-01`);

  const { data, error } = await db
    .from("reservations")
    .select("status, persons, reservation_date, hour, vehicle_id")
    .gte("reservation_date", start)
    .lt("reservation_date", nextStart);

  if (error) {
    console.error("[admin stats] 조회 실패:", error.message);
    return apiError("통계를 불러오지 못했어요.", 500);
  }

  const totals = { waiting: 0, confirmed: 0, cancelled: 0, completed: 0 }; // 예약 건수
  let confirmedPersons = 0;
  const runsByDay = new Map<string, Set<string>>(); // 날짜별 확정 운행(중복 제거)
  const allRuns = new Set<string>();

  for (const r of data ?? []) {
    if (r.status in totals) totals[r.status as keyof typeof totals] += 1;
    if (r.status === "confirmed") {
      confirmedPersons += r.persons;
      const runKey = `${r.reservation_date}|${r.hour}|${r.vehicle_id}`;
      allRuns.add(runKey);
      if (!runsByDay.has(r.reservation_date)) runsByDay.set(r.reservation_date, new Set());
      runsByDay.get(r.reservation_date)!.add(runKey);
    }
  }

  const by_day = [...runsByDay.entries()]
    .map(([date, set]) => ({ date, runs: set.size }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return json({
    month,
    totals, // 상태별 예약 건수
    confirmed_persons: confirmedPersons,
    confirmed_runs: allRuns.size, // 확정 운행 횟수(합승 1회)
    by_day, // [{ date, runs }]
  });
}
