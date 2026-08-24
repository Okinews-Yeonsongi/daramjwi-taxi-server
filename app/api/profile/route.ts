import { getAuthUser } from "@/lib/supabase/user";
import { createAdminClient } from "@/lib/supabase/admin";
import { json, apiError, readJson } from "@/lib/api/http";
import { authPhoneToLocal, normalizeKoreanMobile } from "@/lib/api/phone";
import type { Database } from "@/lib/supabase/types";

/**
 * 차량번호(plate)를 받아서 vehicles와 매칭하고 vehicle_id 반환.
 * 매칭되는 row 있으면 그 id, 없으면 빈 slot(plate_number NULL)에 등록해서 그 id.
 * 빈 slot 없으면 null 반환 (차량 초과).
 */
async function resolveVehicleByPlate(plate: string): Promise<number | null> {
  const admin = createAdminClient();
  const trimmed = plate.trim();
  if (!trimmed) return null;

  // 1) 이미 등록된 번호인지
  const { data: existing } = await admin
    .from("vehicles")
    .select("id")
    .eq("plate_number", trimmed)
    .maybeSingle();
  if (existing) return existing.id;

  // 2) 빈 slot (plate_number NULL)에 등록
  const { data: empty } = await admin
    .from("vehicles")
    .select("id")
    .is("plate_number", null)
    .eq("is_active", true)
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!empty) return null; // 빈 자리 없음

  await admin.from("vehicles").update({ plate_number: trimmed }).eq("id", empty.id);
  return empty.id;
}

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

  const body = await readJson<{
    name?: string;
    phone?: string;
    role?: "resident" | "admin";
    vehicle_id?: number | null;
    vehicle_plate?: string | null;
  }>(request);
  const name = body?.name?.trim();
  if (!name) return apiError("이름을 입력해 주세요.", 400);
  if (name.length > 50) return apiError("이름이 너무 길어요.", 400);

  // 이미 있는지 확인 (카카오 콜백에서 미리 만들어둔 경우 upsert 처리)
  const { data: existing } = await auth.supabase
    .from("profiles")
    .select("*")
    .eq("id", auth.user.id)
    .maybeSingle();

  // 전화번호: 인증된 번호(OTP) 우선, 없으면(카카오) 입력값 사용
  let phone = authPhoneToLocal(auth.user.phone);
  if (!phone) {
    const local = body?.phone ? normalizeKoreanMobile(body.phone) : null;
    if (!local) {
      return apiError("전화번호를 입력해 주세요. (예: 010-1234-5678)", 400);
    }
    phone = local;
  }

  // 역할 (기본 resident, admin 선택 가능)
  const role: "resident" | "admin" = body?.role === "admin" ? "admin" : "resident";

  // 담당 차량 (admin일 때만 의미. plate 우선 매칭·자동등록)
  let vehicleId: number | null = null;
  if (role === "admin") {
    if (body?.vehicle_plate) {
      vehicleId = await resolveVehicleByPlate(body.vehicle_plate);
      if (vehicleId == null) return apiError("등록 가능한 차량 자리가 없어요. 관리자에게 문의하세요.", 409);
    } else if (typeof body?.vehicle_id === "number") {
      vehicleId = body.vehicle_id;
    }
  }

  if (existing) {
    // 카카오 콜백이 만들어둔 미완성 프로필을 완성 (name/phone/role/vehicle_id 갱신)
    const { data, error } = await auth.supabase
      .from("profiles")
      .update({ phone, name, role, vehicle_id: vehicleId, updated_at: new Date().toISOString() })
      .eq("id", auth.user.id)
      .select()
      .single();
    if (error) {
      console.error("[profile POST] update 실패:", error.message);
      return apiError("프로필 저장에 실패했어요.", 500);
    }
    return json({ profile: data, created: false });
  }

  const { data, error } = await auth.supabase
    .from("profiles")
    .insert({ id: auth.user.id, phone, name, role, vehicle_id: vehicleId })
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

  const body = await readJson<{ name?: string; vehicle_id?: number | null; vehicle_plate?: string | null }>(request);
  const patch: ProfileUpdate = {};

  if (body?.name !== undefined) {
    const name = body.name.trim();
    if (!name) return apiError("이름은 비울 수 없어요.", 400);
    if (name.length > 50) return apiError("이름이 너무 길어요.", 400);
    patch.name = name;
  }

  // 기사님 담당 차량 변경 — plate 우선 (매칭·자동등록), 없으면 vehicle_id
  if (body?.vehicle_plate !== undefined) {
    if (body.vehicle_plate === null || body.vehicle_plate.trim() === "") {
      patch.vehicle_id = null;
    } else {
      const vid = await resolveVehicleByPlate(body.vehicle_plate);
      if (vid == null) return apiError("등록 가능한 차량 자리가 없어요.", 409);
      patch.vehicle_id = vid;
    }
  } else if (body?.vehicle_id !== undefined) {
    if (body.vehicle_id !== null && !Number.isInteger(body.vehicle_id)) {
      return apiError("차량 ID가 올바르지 않아요.", 400);
    }
    patch.vehicle_id = body.vehicle_id;
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
