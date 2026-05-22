import { requireAdmin } from "@/lib/api/admin";
import { json, apiError } from "@/lib/api/http";
import type { ReservationStatus } from "@/lib/supabase/types";

const STATUSES: ReservationStatus[] = ["waiting", "confirmed", "cancelled", "completed"];

/**
 * GET /api/admin/reservations?status=waiting&date=YYYY-MM-DD   🔒(admin)
 * 예약 필터 조회. 주민 이름·전화, 장소명, 시간라벨, 차량코드까지 포함.
 * status / date 는 선택 (없으면 전체).
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { db } = guard;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const date = url.searchParams.get("date");
  if (status && !STATUSES.includes(status as ReservationStatus)) return apiError("status 값이 올바르지 않아요.", 400);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return apiError("date 형식이 올바르지 않아요.", 400);

  let q = db
    .from("reservations")
    .select("*")
    .order("reservation_date", { ascending: true })
    .order("hour", { ascending: true })
    .order("created_at", { ascending: true });
  if (status) q = q.eq("status", status as ReservationStatus);
  if (date) q = q.eq("reservation_date", date);

  const [resvRes, profRes, locRes, slotRes, vehRes] = await Promise.all([
    q,
    db.from("profiles").select("id, name, phone"),
    db.from("locations").select("id, name, emoji, category"),
    db.from("time_slots").select("hour, label"),
    db.from("vehicles").select("id, code"),
  ]);

  if (resvRes.error) {
    console.error("[admin reservations] 조회 실패:", resvRes.error.message);
    return apiError("예약 목록을 불러오지 못했어요.", 500);
  }

  const profMap = new Map((profRes.data ?? []).map((p) => [p.id, p]));
  const locMap = new Map((locRes.data ?? []).map((l) => [l.id, l]));
  const slotMap = new Map((slotRes.data ?? []).map((s) => [s.hour, s.label]));
  const vehMap = new Map((vehRes.data ?? []).map((v) => [v.id, v.code]));

  const reservations = (resvRes.data ?? []).map((r) => {
    const p = profMap.get(r.user_id);
    return {
      id: r.id,
      reservation_date: r.reservation_date,
      hour: r.hour,
      time_label: slotMap.get(r.hour) ?? null,
      persons: r.persons,
      status: r.status,
      resident: { id: r.user_id, name: p?.name ?? null, phone: p?.phone ?? null },
      departure: locMap.get(r.departure_location_id) ?? null,
      arrival: locMap.get(r.arrival_location_id) ?? null,
      vehicle_code: r.vehicle_id != null ? (vehMap.get(r.vehicle_id) ?? null) : null,
      cancel_reason: r.cancel_reason,
      confirmed_at: r.confirmed_at,
      cancelled_at: r.cancelled_at,
      created_at: r.created_at,
    };
  });

  return json({ reservations });
}
