import { getAuthUser } from "@/lib/supabase/user";
import { json, apiError, readJson } from "@/lib/api/http";
import { authPhoneToLocal, normalizeKoreanMobile } from "@/lib/api/phone";
import type { Database } from "@/lib/supabase/types";

type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

/**
 * POST /api/profile   (헤더: Authorization: Bearer <access_token>)
 * body: { name: string, phone?: string }
 * → 온보딩(최초 프로필 생성).
 *   - OTP 로그인: 전화번호는 인증된 정보에서 자동으로 채움 (body.phone 무시)
 *   - 카카오 로그인: 인증된 전화번호가 없으므로 body.phone 으로 입력받음
 *     (추후 카카오싱크 전화번호 검수 통과 시 자동수집으로 전환)
 *   (집 주소는 받지 않습니다 — 픽업/드랍은 마을 거점만 가능)
 *   이미 프로필이 있으면 기존 것을 그대로 반환합니다(중복 제출 방어).
 */
export async function POST(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const body = await readJson<{ name?: string; phone?: string }>(request);
  const name = body?.name?.trim();
  if (!name) return apiError("이름을 입력해 주세요.", 400);
  if (name.length > 50) return apiError("이름이 너무 길어요.", 400);

  // 이미 있으면 그대로 반환
  const { data: existing } = await auth.supabase
    .from("profiles")
    .select("*")
    .eq("id", auth.user.id)
    .maybeSingle();
  if (existing) return json({ profile: existing, created: false });

  // 전화번호: 인증된 번호(OTP) 우선, 없으면(카카오) 입력값 사용
  let phone = authPhoneToLocal(auth.user.phone);
  if (!phone) {
    const local = body?.phone ? normalizeKoreanMobile(body.phone) : null;
    if (!local) {
      return apiError("전화번호를 입력해 주세요. (예: 010-1234-5678)", 400);
    }
    phone = local;
  }

  const { data, error } = await auth.supabase
    .from("profiles")
    .insert({ id: auth.user.id, phone, name })
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
 * body: { name?: string }
 * → 프로필 수정 (전화번호는 변경 불가 — 본인 인증 키이므로).
 */
export async function PATCH(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const body = await readJson<{ name?: string }>(request);
  const patch: ProfileUpdate = {};

  if (body?.name !== undefined) {
    const name = body.name.trim();
    if (!name) return apiError("이름은 비울 수 없어요.", 400);
    if (name.length > 50) return apiError("이름이 너무 길어요.", 400);
    patch.name = name;
  }

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
