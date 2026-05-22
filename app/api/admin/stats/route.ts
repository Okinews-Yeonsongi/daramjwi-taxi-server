import { requireAdmin, monthBounds } from "@/lib/api/admin";
import { json, apiError } from "@/lib/api/http";
import { kstTodayString } from "@/lib/api/time";

/**
 * GET /api/admin/stats?month=YYYY-MM   🔒(admin)
 * 월 통계: 상태별 건수, 확정 인원 합, 일자별 확정 건수.
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
    .select("status, persons, reservation_date")
    .gte("reservation_date", start)
    .lt("reservation_date", nextStart);

  if (error) {
    console.error("[admin stats] 조회 실패:", error.message);
    return apiError("통계를 불러오지 못했어요.", 500);
  }

  const totals = { waiting: 0, confirmed: 0, cancelled: 0, completed: 0 };
  let confirmedPersons = 0;
  const byDay = new Map<string, number>();
  for (const r of data ?? []) {
    if (r.status in totals) totals[r.status as keyof typeof totals] += 1;
    if (r.status === "confirmed") {
      confirmedPersons += r.persons;
      byDay.set(r.reservation_date, (byDay.get(r.reservation_date) ?? 0) + 1);
    }
  }

  const by_day = [...byDay.entries()]
    .map(([date, confirmed]) => ({ date, confirmed }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return json({ month, totals, confirmed_persons: confirmedPersons, by_day });
}
