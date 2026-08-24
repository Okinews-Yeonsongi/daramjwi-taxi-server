import { requireAdmin } from "@/lib/api/admin";
import { json, apiError, readJson } from "@/lib/api/http";

/**
 * POST /api/admin/reservations/:id/trip-start   🔐
 * body: { lat?: number, lng?: number }
 * 운행 시작 시각·위치 기록. lat/lng 없이도 저장 가능 (GPS 실패 시).
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
      trip_started_at: nowIso,
      trip_start_lat: lat,
      trip_start_lng: lng,
      updated_at: nowIso,
    })
    .eq("id", rid)
    .select("id, trip_started_at, trip_start_lat, trip_start_lng")
    .maybeSingle();

  if (error) {
    console.error("[trip-start] 실패:", error.message);
    return apiError("운행 시작 기록에 실패했어요.", 500);
  }
  if (!data) return apiError("예약을 찾을 수 없어요.", 404);
  return json({ ok: true, reservation: data });
}
