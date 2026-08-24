import { requireAdmin } from "@/lib/api/admin";
import { json, apiError } from "@/lib/api/http";

const BUCKET = "receipts";
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

/**
 * POST /api/admin/reservations/:id/receipt   🔐
 * multipart/form-data: file
 * 영수증 사진 업로드 → Supabase Storage 'receipts' bucket에 저장.
 * 경로: {reservation_date}/{reservation_id}_{timestamp}.{ext}
 * DB의 receipt_image_path 갱신.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { db } = guard;

  const { id } = await ctx.params;
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return apiError("잘못된 예약이에요.", 400);

  // 예약 조회 (파일명 구성용)
  const { data: r } = await db
    .from("reservations")
    .select("id, reservation_date, receipt_image_path")
    .eq("id", rid)
    .maybeSingle();
  if (!r) return apiError("예약을 찾을 수 없어요.", 404);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return apiError("영수증 이미지를 첨부해 주세요.", 400);
  if (file.size > MAX_SIZE) return apiError("파일이 너무 커요 (최대 5MB).", 413);
  if (!ALLOWED.includes(file.type)) return apiError("이미지 파일만 업로드 가능해요 (JPG/PNG/WEBP).", 415);

  const ext = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
  const path = `${r.reservation_date}/${r.id}_${Date.now()}.${ext}`;

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await db.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type,
    upsert: false,
  });
  if (upErr) {
    console.error("[receipt POST] 업로드 실패:", upErr.message);
    return apiError("영수증 업로드 실패: " + upErr.message, 500);
  }

  // 이전 영수증 삭제 (교체 시)
  if (r.receipt_image_path && r.receipt_image_path !== path) {
    await db.storage.from(BUCKET).remove([r.receipt_image_path]).catch(() => {});
  }

  const { data: updated, error: updErr } = await db
    .from("reservations")
    .update({ receipt_image_path: path, updated_at: new Date().toISOString() })
    .eq("id", rid)
    .select("id, receipt_image_path")
    .maybeSingle();
  if (updErr) {
    console.error("[receipt POST] DB 갱신 실패:", updErr.message);
    return apiError("경로 저장 실패.", 500);
  }

  // 접근용 signed URL 발급 (1시간짜리) — 프론트가 미리보기용
  const { data: sig } = await db.storage.from(BUCKET).createSignedUrl(path, 60 * 60);

  return json({ ok: true, path, signed_url: sig?.signedUrl ?? null, reservation: updated });
}

/**
 * GET /api/admin/reservations/:id/receipt   🔐
 * 저장된 영수증 signed URL 발급 (1시간).
 */
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { db } = guard;

  const { id } = await ctx.params;
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return apiError("잘못된 예약이에요.", 400);

  const { data: r } = await db
    .from("reservations")
    .select("receipt_image_path")
    .eq("id", rid)
    .maybeSingle();
  if (!r?.receipt_image_path) return apiError("영수증이 없어요.", 404);

  const { data: sig, error } = await db.storage.from(BUCKET).createSignedUrl(r.receipt_image_path, 60 * 60);
  if (error || !sig) return apiError("영수증 URL 발급 실패.", 500);
  return json({ path: r.receipt_image_path, signed_url: sig.signedUrl });
}

/**
 * DELETE /api/admin/reservations/:id/receipt   🔐
 * 영수증 삭제 (Storage + DB 경로).
 */
export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { db } = guard;

  const { id } = await ctx.params;
  const rid = Number(id);
  if (!Number.isInteger(rid) || rid <= 0) return apiError("잘못된 예약이에요.", 400);

  const { data: r } = await db
    .from("reservations")
    .select("receipt_image_path")
    .eq("id", rid)
    .maybeSingle();
  if (!r?.receipt_image_path) return json({ ok: true }); // 이미 없음

  await db.storage.from(BUCKET).remove([r.receipt_image_path]).catch(() => {});
  await db.from("reservations").update({ receipt_image_path: null, updated_at: new Date().toISOString() }).eq("id", rid);
  return json({ ok: true });
}
