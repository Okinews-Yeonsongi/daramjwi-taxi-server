import { requireAdmin, loadNotifyParties, monthBounds, countConfirmedRuns } from "@/lib/api/admin";
import { json, apiError } from "@/lib/api/http";
import { DAILY_LIMIT, MONTHLY_LIMIT } from "@/lib/constants";
import { notifyResidentConfirmed } from "@/lib/notify";

/**
 * PATCH /api/admin/reservations/:id/confirm   🔒(admin)
 * 대기 예약을 확정. 일/월 확정 한도(4/112) 검사 후 → 주민 알림.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { auth, db, vehicleId: adminVehicleId } = guard;

  const { id } = await ctx.params;
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return apiError("잘못된 예약이에요.", 400);

  const { data: r } = await db.from("reservations").select("*").eq("id", rid).maybeSingle();
  if (!r) return apiError("예약을 찾을 수 없어요.", 404);
  if (r.status !== "waiting") return apiError("대기 중인 예약만 확정할 수 있어요.", 400);

  // 배분 정책(B안): 확정하는 기사님이 담당 차량 있으면 그 차량으로 재배정
  // 담당 없으면(기사님 vehicle_id=NULL) 원래 배정된 vehicle_id 유지
  const vehicleId = adminVehicleId ?? r.vehicle_id;
  if (vehicleId == null) return apiError("이 예약에 배정된 차량이 없어요. (관리자 문의)", 409);

  // 한도 검사 — 재배정된 vehicle_id 기준
  const { start, nextStart } = monthBounds(r.reservation_date);
  const { count: sameRunConfirmed } = await db
    .from("reservations")
    .select("*", { count: "exact", head: true })
    .eq("status", "confirmed")
    .eq("reservation_date", r.reservation_date)
    .eq("hour", r.hour)
    .eq("vehicle_id", vehicleId);

  if ((sameRunConfirmed ?? 0) === 0) {
    const [dayRuns, monRuns] = await Promise.all([
      countConfirmedRuns(db, { date: r.reservation_date }),
      countConfirmedRuns(db, { start, nextStart }),
    ]);
    if (dayRuns >= DAILY_LIMIT)
      return apiError(`${r.reservation_date}의 운행 한도(${DAILY_LIMIT}회)를 이미 채웠어요.`, 409, "DAILY_LIMIT");
    if (monRuns >= MONTHLY_LIMIT)
      return apiError(`이번 달 운행 한도(${MONTHLY_LIMIT}회)를 이미 채웠어요.`, 409, "MONTHLY_LIMIT");
  }

  const nowIso = new Date().toISOString();
  const { data: updated } = await db
    .from("reservations")
    .update({
      status: "confirmed",
      confirmed_at: nowIso,
      confirmed_by: auth.user.id,
      vehicle_id: vehicleId, // ← 확정 시 기사님 차량으로 재배정 (B안)
      updated_at: nowIso,
    })
    .eq("id", rid)
    .eq("status", "waiting")
    .select("*")
    .maybeSingle();
  if (!updated) return apiError("예약 상태가 방금 변경됐어요. 새로고침 후 다시 시도해 주세요.", 409);

  try {
    const parties = await loadNotifyParties(db, updated);
    await notifyResidentConfirmed(parties);
  } catch (e) {
    console.error("[admin confirm] 알림 스텁 실패(무시):", (e as Error).message);
  }

  return json({ reservation: updated });
}
