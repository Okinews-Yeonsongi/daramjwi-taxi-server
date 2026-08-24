import { requireAdmin } from "@/lib/api/admin";
import { json, apiError, readJson } from "@/lib/api/http";

/**
 * PATCH /api/admin/reservations/:id/fare   🔐
 * body: { amount: number }  (원 단위, 정수. null 또는 0 이하는 지움)
 * 기사님이 입력한 정산 금액. 행정팀 참고용.
 */
export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { db } = guard;

  const { id } = await ctx.params;
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return apiError("잘못된 예약이에요.", 400);

  const body = await readJson<{ amount?: number | null }>(request);
  let amount: number | null = null;
  if (typeof body?.amount === "number" && body.amount > 0) {
    amount = Math.floor(body.amount);
    if (amount > 1_000_000) return apiError("금액이 너무 커요.", 400);
  }

  const { data, error } = await db
    .from("reservations")
    .update({ fare_amount: amount, updated_at: new Date().toISOString() })
    .eq("id", rid)
    .select("id, fare_amount")
    .maybeSingle();

  if (error) {
    console.error("[fare PATCH] 실패:", error.message);
    return apiError("금액 저장에 실패했어요.", 500);
  }
  if (!data) return apiError("예약을 찾을 수 없어요.", 404);
  return json({ ok: true, fare_amount: data.fare_amount });
}
