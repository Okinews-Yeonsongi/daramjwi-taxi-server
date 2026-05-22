import { createAnonClient } from "@/lib/supabase/anon";
import { createUserClient } from "@/lib/supabase/user";
import { json, apiError, readJson } from "@/lib/api/http";
import { normalizeKoreanMobile, toE164 } from "@/lib/api/phone";

/**
 * POST /api/auth/verify-otp
 * body: { phone: string, code: string }
 * → 인증번호 검증 후 로그인 세션(토큰)을 발급합니다.
 *   profile이 없으면 needsOnboarding=true (이름/주소 입력 단계로 보내면 됨).
 */
export async function POST(request: Request) {
  const body = await readJson<{ phone?: string; code?: string }>(request);
  if (!body?.phone || !body?.code) {
    return apiError("전화번호와 인증번호를 입력해 주세요.", 400);
  }

  const local = normalizeKoreanMobile(body.phone);
  if (!local) return apiError("올바른 휴대폰 번호가 아니에요.", 400);

  const supabase = createAnonClient();
  const { data, error } = await supabase.auth.verifyOtp({
    phone: toE164(local),
    token: body.code.trim(),
    type: "sms",
  });

  if (error || !data.session || !data.user) {
    return apiError("인증번호가 올바르지 않거나 만료됐어요.", 401, "OTP_INVALID");
  }

  // 발급된 세션 토큰으로 본인 프로필 조회 (RLS: 본인 것만)
  const userClient = createUserClient(data.session.access_token);
  const { data: profile } = await userClient
    .from("profiles")
    .select("*")
    .eq("id", data.user.id)
    .maybeSingle();

  return json({
    session: {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      expires_in: data.session.expires_in,
      token_type: data.session.token_type,
    },
    user: { id: data.user.id, phone: local },
    profile: profile ?? null,
    needsOnboarding: !profile,
  });
}
