import { requireAdmin, loadNotifyParties, monthBounds } from "@/lib/api/admin";
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
  const { auth, db } = guard;

  const { id } = await ctx.params;
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return apiError("잘못된 예약이에요.", 400);

  const { data: r } = await db.from("reservations").select("*").eq("id", rid).maybeSingle();
  if (!r) return apiError("예약을 찾을 수 없어요.", 404);
  if (r.status !== "waiting") return apiError("대기 중인 예약만 확정할 수 있어요.", 400);

  // 한도 검사 (그 운행 날짜 기준, confirmed 기준)
  const { start, nextStart } = monthBounds(r.reservation_date);
  const [dayC, monC] = await Promise.all([
    db.from("reservations").select("*", { count: "exact", head: true }).eq("status", "confirmed").eq("reservation_date", r.reservation_date),
    db.from("reservations").select("*", { count: "exact", head: true }).eq("status", "confirmed").gte("reservation_date", start).lt("reservation_date", nextStart),
  ]);
  if ((dayC.count ?? 0) >= DAILY_LIMIT)
    return apiError(`${r.reservation_date}의 확정 한도(${DAILY_LIMIT}회)를 이미 채웠어요.`, 409, "DAILY_LIMIT");
  if ((monC.count ?? 0) >= MONTHLY_LIMIT)
    return apiError(`이번 달 확정 한도(${MONTHLY_LIMIT}회)를 이미 채웠어요.`, 409, "MONTHLY_LIMIT");

  const nowIso = new Date().toISOString();
  const { data: updated } = await db
    .from("reservations")
    .update({ status: "confirmed", confirmed_at: nowIso, confirmed_by: auth.user.id, updated_at: nowIso })
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
