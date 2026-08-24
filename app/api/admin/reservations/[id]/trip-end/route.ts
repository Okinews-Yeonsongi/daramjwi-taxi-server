import { requireAdmin } from "@/lib/api/admin";
import { json, apiError, readJson } from "@/lib/api/http";

/**
 * POST /api/admin/reservations/:id/trip-end   🔐
 * body: { lat?: number, lng?: number }
 * 운행 도착 시각·위치 기록.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { db } = guard;

  const { id } = await ctx.params;
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return apiError("잘못된 예약이에요.", 400);

  const body = await readJson<{ lat?: number; lng?: number }>(request);
  const lat = typeof body?.lat === "number" ? body.lat : null;
  const lng = typeof body?.lng === "number" ? body.lng : null;
  const nowIso = new Date().toISOString();

  const { data, error } = await db
    .from("reservations")
    .update({
      trip_ended_at: nowIso,
      trip_end_lat: lat,
      trip_end_lng: lng,
      updated_at: nowIso,
    })
    .eq("id", rid)
    .select("id, trip_ended_at, trip_end_lat, trip_end_lng")
    .maybeSingle();

  if (error) {
    console.error("[trip-end] 실패:", error.message);
    return apiError("운행 도착 기록에 실패했어요.", 500);
  }
  if (!data) return apiError("예약을 찾을 수 없어요.", 404);
  return json({ ok: true, reservation: data });
}
