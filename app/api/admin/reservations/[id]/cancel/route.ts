import { requireAdmin, loadNotifyParties } from "@/lib/api/admin";
import { json, apiError, readJson } from "@/lib/api/http";
import { notifyResidentCancelled } from "@/lib/notify";

/**
 * PATCH /api/admin/reservations/:id/cancel   🔒(admin)
 * body: { reason: string }  (사유 필수)
 * 대기/확정 예약을 취소 → 주민에게 사유 포함 알림.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { auth, db } = guard;

  const { id } = await ctx.params;
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return apiError("잘못된 예약이에요.", 400);

  const body = await readJson<{ reason?: string }>(request);
  const reason = body?.reason?.trim();
  if (!reason) return apiError("취소 사유를 입력해 주세요.", 400);
  if (reason.length > 200) return apiError("취소 사유가 너무 길어요.", 400);

  const { data: r } = await db.from("reservations").select("*").eq("id", rid).maybeSingle();
  if (!r) return apiError("예약을 찾을 수 없어요.", 404);
  if (r.status !== "waiting" && r.status !== "confirmed")
    return apiError("이미 취소되었거나 완료된 예약이에요.", 400);

  const nowIso = new Date().toISOString();
  const { data: updated } = await db
    .from("reservations")
    .update({
      status: "cancelled",
      cancelled_at: nowIso,
      cancelled_by: auth.user.id,
      cancel_reason: reason,
      updated_at: nowIso,
    })
    .eq("id", rid)
    .in("status", ["waiting", "confirmed"])
    .select("*")
    .maybeSingle();
  if (!updated) return apiError("예약 상태가 방금 변경됐어요. 새로고침 후 다시 시도해 주세요.", 409);

  try {
    const parties = await loadNotifyParties(db, updated);
    await notifyResidentCancelled({ ...parties, reason });
  } catch (e) {
    console.error("[admin cancel] 알림 스텁 실패(무시):", (e as Error).message);
  }

  return json({ reservation: updated });
}
