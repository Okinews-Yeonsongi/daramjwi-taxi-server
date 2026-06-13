import { requireAdmin } from "@/lib/api/admin";
import { json, apiError, readJson } from "@/lib/api/http";
import { normalizeKoreanMobile } from "@/lib/api/phone";

/**
 * PATCH /api/admin/reservations/:id/phone   🔒(admin)
 * body: { phone: string }
 * 대기/확정 상태 예약의 연락처 수정.
 *  - 전화예약(guest): reservations.guest_phone 갱신
 *  - 회원 예약: profiles.phone 갱신 (사장님이 어르신 번호 잘못 들었을 때 정정용)
 * 전화번호 자유 형식 — 숫자만 추출해 최소 4자리만 있으면 OK.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { db } = guard;

  const { id } = await ctx.params;
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return apiError("잘못된 예약이에요.", 400);

  const body = await readJson<{ phone?: string }>(request);
  const raw = (body?.phone ?? "").trim();
  const digits = raw.replace(/[^0-9]/g, "");
  if (digits.length < 4) return apiError("전화번호 끝 4자리 이상은 입력해 주세요.", 400);
  const newPhone = normalizeKoreanMobile(raw) ?? raw;

  const { data: r } = await db.from("reservations").select("id, user_id, status").eq("id", rid).maybeSingle();
  if (!r) return apiError("예약을 찾을 수 없어요.", 404);
  if (r.status === "cancelled") return apiError("취소된 예약은 수정할 수 없어요.", 400);

  if (r.user_id) {
    // 회원 예약 → profiles.phone 갱신
    const { error } = await db.from("profiles").update({ phone: newPhone, updated_at: new Date().toISOString() }).eq("id", r.user_id);
    if (error) {
      console.error("[admin phone PATCH] profiles 갱신 실패:", error.message);
      return apiError("연락처 수정에 실패했어요.", 500);
    }
  } else {
    // 게스트 예약 → guest_phone 갱신
    const { error } = await db.from("reservations").update({ guest_phone: newPhone, updated_at: new Date().toISOString() }).eq("id", rid);
    if (error) {
      console.error("[admin phone PATCH] guest_phone 갱신 실패:", error.message);
      return apiError("연락처 수정에 실패했어요.", 500);
    }
  }

  return json({ ok: true, phone: newPhone });
}
