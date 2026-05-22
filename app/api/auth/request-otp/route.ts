import { createAnonClient } from "@/lib/supabase/anon";
import { json, apiError, readJson } from "@/lib/api/http";
import { normalizeKoreanMobile, toE164 } from "@/lib/api/phone";

/**
 * POST /api/auth/request-otp
 * body: { phone: string }   예: "010-1234-5678"
 * → 그 번호로 SMS 인증번호를 발송합니다. (계정 없으면 자동 생성)
 */
export async function POST(request: Request) {
  const body = await readJson<{ phone?: string }>(request);
  if (!body?.phone) return apiError("전화번호를 입력해 주세요.", 400);

  const local = normalizeKoreanMobile(body.phone);
  if (!local) {
    return apiError("올바른 휴대폰 번호가 아니에요. (예: 010-1234-5678)", 400);
  }

  const supabase = createAnonClient();
  const { error } = await supabase.auth.signInWithOtp({
    phone: toE164(local),
    options: { shouldCreateUser: true },
  });

  if (error) {
    // 가장 흔한 원인: Supabase에 SMS(전화) 인증 공급자가 아직 연결되지 않음.
    console.error("[request-otp] signInWithOtp 실패:", error.message);
    return apiError(
      "인증번호 발송에 실패했어요. 잠시 후 다시 시도해 주세요.",
      502,
      "OTP_SEND_FAILED"
    );
  }

  return json({ success: true, message: "인증번호를 문자로 보냈어요." });
}
