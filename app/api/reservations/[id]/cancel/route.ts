import { getAuthUser } from "@/lib/supabase/user";
import { json, apiError } from "@/lib/api/http";
import { isSlotInFuture } from "@/lib/api/time";
import { notifyAdminSelfCancel, notifyResidentSelfCancelled } from "@/lib/notify";

/**
 * PATCH /api/reservations/:id/cancel   🔒
 * 본인 예약 취소. 운행 시작 시각 이후엔 취소 불가.
 * - 카운트(한도/확정횟수)는 status로 계산하므로 자동 복구됨.
 * - 알림: 항상 본인에게 취소 확인 + 확정 예약이었으면 기사님께도 알림. (현재는 로그 스텁)
 */
export async function PATCH(
  request: Request,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const { id } = await ctx.params;
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return apiError("잘못된 예약이에요.", 400);

  // 본인 예약만 조회됨(RLS)
  const { data: existing, error: readErr } = await auth.supabase
    .from("reservations")
    .select("*")
    .eq("id", rid)
    .maybeSingle();
  if (readErr) {
    console.error("[cancel] 조회 실패:", readErr.message);
    return apiError("예약을 불러오지 못했어요.", 500);
  }
  if (!existing) return apiError("예약을 찾을 수 없어요.", 404);

  if (existing.status !== "waiting" && existing.status !== "confirmed") {
    return apiError("이미 취소되었거나 완료된 예약이에요.", 400);
  }
  if (!isSlotInFuture(existing.reservation_date, existing.hour)) {
    return apiError("이미 운행이 시작되어 취소할 수 없어요.", 400);
  }

  const nowIso = new Date().toISOString();
  const { data: updated, error: updErr } = await auth.supabase
    .from("reservations")
    .update({
      status: "cancelled",
      cancelled_at: nowIso,
      cancelled_by: auth.user.id,
      updated_at: nowIso,
    })
    .eq("id", rid)
    .in("status", ["waiting", "confirmed"]) // 동시 변경 방어
    .select("*")
    .maybeSingle();

  if (updErr) {
    console.error("[cancel] 취소 실패:", updErr.message);
    return apiError("취소에 실패했어요.", 500);
  }
  if (!updated) {
    return apiError("예약 상태가 방금 변경됐어요. 새로고침 후 다시 시도해 주세요.", 409);
  }

  // 알림: 항상 본인에게 취소 확인 + 확정이었으면 기사님에게도. (실패해도 취소는 유효)
  try {
    const [{ data: prof }, { data: locs }] = await Promise.all([
      auth.supabase.from("profiles").select("name, phone").eq("id", auth.user.id).maybeSingle(),
      auth.supabase
        .from("locations")
        .select("id, name")
        .in("id", [existing.departure_location_id, existing.arrival_location_id]),
    ]);
    const nameOf = (lid: number) => locs?.find((l) => l.id === lid)?.name ?? "";
    const party = {
      residentName: prof?.name ?? "주민",
      residentPhone: prof?.phone ?? "",
      date: existing.reservation_date,
      hour: existing.hour,
      minute: existing.departure_minute,
      departureName: nameOf(existing.departure_location_id),
      arrivalName: nameOf(existing.arrival_location_id),
      userId: auth.user.id, // 푸시 발송용
    };

    // case 3: 항상 본인에게 취소 확인
    await notifyResidentSelfCancelled(party);

    // case 4: 확정 예약 본인 취소면 기사님에게도
    if (existing.status === "confirmed") {
      await notifyAdminSelfCancel({ ...party, persons: existing.persons });
    }
  } catch (e) {
    console.error("[cancel] 알림 스텁 실패(무시):", (e as Error).message);
  }

  return json({ reservation: updated });
}
