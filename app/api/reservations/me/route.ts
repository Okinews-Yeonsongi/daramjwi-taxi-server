import { getAuthUser } from "@/lib/supabase/user";
import { json, apiError } from "@/lib/api/http";
import { kstTodayString, isSlotInFuture } from "@/lib/api/time";
import type { ReservationStatus } from "@/lib/supabase/types";

function effectiveStatus(status: ReservationStatus, date: string, hour: number): ReservationStatus | "completed" {
  if (status === "cancelled") return "cancelled";
  if (!isSlotInFuture(date, hour)) return "completed";
  return status;
}

/**
 * GET /api/reservations/me   🔒
 * 내 예약 목록 (오늘 이후, 취소 제외). 장소명·시간라벨·차량코드까지 채워서 반환.
 */
export async function GET(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const today = kstTodayString();

  const [resvRes, locRes, slotRes, vehRes] = await Promise.all([
    auth.supabase
      .from("reservations")
      .select("*")
      .neq("status", "cancelled")
      .gte("reservation_date", today)
      .order("reservation_date", { ascending: true })
      .order("hour", { ascending: true }),
    auth.supabase.from("locations").select("id, name, emoji, category"),
    auth.supabase.from("time_slots").select("hour, label"),
    auth.supabase.from("vehicles").select("id, code"),
  ]);

  if (resvRes.error) {
    console.error("[reservations/me] 조회 실패:", resvRes.error.message);
    return apiError("예약 목록을 불러오지 못했어요.", 500);
  }

  const locMap = new Map((locRes.data ?? []).map((l) => [l.id, l]));
  const slotMap = new Map((slotRes.data ?? []).map((s) => [s.hour, s.label]));
  const vehMap = new Map((vehRes.data ?? []).map((v) => [v.id, v.code]));

  const reservations = (resvRes.data ?? []).map((r) => ({
    id: r.id,
    reservation_date: r.reservation_date,
    hour: r.hour,
    time_label: slotMap.get(r.hour) ?? null,
    persons: r.persons,
    status: r.status,
    effective_status: effectiveStatus(r.status, r.reservation_date, r.hour),
    departure: locMap.get(r.departure_location_id) ?? null,
    arrival: locMap.get(r.arrival_location_id) ?? null,
    vehicle_code: r.vehicle_id != null ? (vehMap.get(r.vehicle_id) ?? null) : null,
    confirmed_at: r.confirmed_at,
    cancelled_at: r.cancelled_at,
    cancel_reason: r.cancel_reason,
    created_at: r.created_at,
  }));

  return json({ reservations });
}
