import { createAdminClient } from "@/lib/supabase/admin";
import { getAuthUser } from "@/lib/supabase/user";
import { json, apiError } from "@/lib/api/http";
import { kstTodayString } from "@/lib/api/time";
import { MAX_PERSONS_PER_RUN } from "@/lib/constants";

/**
 * GET /api/runs/today   🔒
 * 오늘 전체 운행 일정 (시간·방향·인원). 차량(A/B) 식별은 주민에게 비공개라 제외합니다.
 * 마을 전체를 봐야 하므로 service_role(관리자) 키로 집계하되, 개인정보는 노출하지 않습니다.
 *
 * 응답: { date, runs: [ { hour, time_label, origin, destination, persons, seats_left } ] }
 */
export async function GET(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const today = kstTodayString();
  const admin = createAdminClient();

  const [resvRes, locRes, slotRes] = await Promise.all([
    admin
      .from("reservations")
      .select("hour, persons, vehicle_id, departure_location_id")
      .eq("reservation_date", today)
      .in("status", ["waiting", "confirmed"]),
    admin.from("locations").select("id, category"),
    admin.from("time_slots").select("hour, label"),
  ]);

  if (resvRes.error) {
    console.error("[runs/today] 조회 실패:", resvRes.error.message);
    return apiError("운행 일정을 불러오지 못했어요.", 500);
  }

  const catOf = new Map((locRes.data ?? []).map((l) => [l.id, l.category]));
  const labelOf = new Map((slotRes.data ?? []).map((s) => [s.hour, s.label]));

  // (시간, 출발카테고리, 차량) 단위로 한 '운행'으로 묶기 — 차량 식별은 응답에서 제외
  const runs = new Map<string, { hour: number; origin: string; persons: number }>();
  for (const r of resvRes.data ?? []) {
    const origin = catOf.get(r.departure_location_id);
    if (!origin) continue;
    const key = `${r.hour}|${origin}|${r.vehicle_id ?? "x"}`;
    const cur = runs.get(key) ?? { hour: r.hour, origin, persons: 0 };
    cur.persons += r.persons;
    runs.set(key, cur);
  }

  const result = [...runs.values()]
    .map((run) => ({
      hour: run.hour,
      time_label: labelOf.get(run.hour) ?? null,
      origin: run.origin,
      destination: run.origin === "cheongsanmyeon" ? "eupnae" : "cheongsanmyeon",
      persons: run.persons,
      seats_left: Math.max(0, MAX_PERSONS_PER_RUN - run.persons),
    }))
    .sort((a, b) => a.hour - b.hour || a.origin.localeCompare(b.origin));

  return json({ date: today, runs: result });
}
