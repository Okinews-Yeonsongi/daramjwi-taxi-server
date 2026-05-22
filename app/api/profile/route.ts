import { getAuthUser } from "@/lib/supabase/user";
import { json, apiError, readJson } from "@/lib/api/http";
import { authPhoneToLocal } from "@/lib/api/phone";
import type { Database } from "@/lib/supabase/types";

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

/**
 * POST /api/profile   (헤더: Authorization: Bearer <access_token>)
 * body: { name: string, address?: string }
 * → 온보딩(최초 프로필 생성). 전화번호는 인증된 정보에서 자동으로 채웁니다.
 *   이미 프로필이 있으면 기존 것을 그대로 반환합니다(중복 제출 방어).
 */
export async function POST(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const body = await readJson<{ name?: string; address?: string }>(request);
  const name = body?.name?.trim();
  if (!name) return apiError("이름을 입력해 주세요.", 400);
  if (name.length > 50) return apiError("이름이 너무 길어요.", 400);
  const address = body?.address?.trim() || null;

  // 이미 있으면 그대로 반환
  const { data: existing } = await auth.supabase
    .from("profiles")
    .select("*")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (existing) return json({ profile: existing, created: false });

  // 전화번호는 클라이언트 입력이 아니라 "인증된 번호"에서 가져옴 (위변조 방지)
  const phone = authPhoneToLocal(auth.user.phone);
  if (!phone) {
    return apiError("전화번호 인증 정보가 없어요. 다시 로그인해 주세요.", 400);
  }

  const { data, error } = await auth.supabase
    .from("profiles")
    .insert({ id: auth.user.id, phone, name, address })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return apiError("이미 등록된 번호예요.", 409);
    console.error("[profile POST] insert 실패:", error.message);
    return apiError("프로필 저장에 실패했어요.", 500);
  }

  return json({ profile: data, created: true }, 201);
}

/**
 * PATCH /api/profile   (헤더: Authorization: Bearer <access_token>)
 * body: { name?: string, address?: string }
 * → 프로필 수정 (전화번호는 변경 불가 — 본인 인증 키이므로).
 */
export async function PATCH(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const body = await readJson<{ name?: string; address?: string }>(request);
  const patch: ProfileUpdate = {};

  if (body?.name !== undefined) {
    const name = body.name.trim();
    if (!name) return apiError("이름은 비울 수 없어요.", 400);
    if (name.length > 50) return apiError("이름이 너무 길어요.", 400);
    patch.name = name;
  }
  if (body?.address !== undefined) patch.address = body.address?.trim() || null;

  if (Object.keys(patch).length === 0) {
    return apiError("수정할 내용이 없어요.", 400);
  }
  patch.updated_at = new Date().toISOString();

  const { data, error } = await auth.supabase
    .from("profiles")
    .update(patch)
    .eq("id", auth.user.id)
    .select()
    .single();

  if (error) {
    console.error("[profile PATCH] update 실패:", error.message);
    return apiError("프로필 수정에 실패했어요.", 500);
  }

  return json({ profile: data });
}
