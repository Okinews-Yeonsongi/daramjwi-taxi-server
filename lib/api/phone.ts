/**
 * 휴대폰 번호 정규화 유틸.
 * 입력 예: "010-1234-5678", "01012345678", "+8210...", "8210..."
 * 내부 저장/표시는 로컬 형식("01012345678"),
 * Supabase OTP 발송은 E.164 형식("+821012345678")을 씁니다.
 */

/** 다양한 입력을 로컬 형식(01012345678)으로 정규화. 유효하지 않으면 null */
export function normalizeKoreanMobile(input: string): string | null {
  if (!input) return null;
  let d = input.replace(/[^0-9]/g, "");
  if (d.startsWith("82")) d = "0" + d.slice(2); // 821012345678 -> 01012345678
  // 010-XXXX-XXXX(11자리) 또는 구형 011/016/017/018/019(+7~8자리)
  if (!/^01[016789]\d{7,8}$/.test(d)) return null;
  return d;
}

/** 로컬 형식(01012345678) -> E.164(+821012345678) */
export function toE164(localPhone: string): string {
  return "+82" + localPhone.slice(1);
}

/** Supabase auth가 저장한 phone("821012345678" 등) -> 로컬 형식. 실패 시 null */
export function authPhoneToLocal(phone: string | undefined | null): string | null {
  if (!phone) return null;
  let d = phone.replace(/[^0-9]/g, "");
  if (d.startsWith("82")) d = "0" + d.slice(2);
  return /^0\d{9,10}$/.test(d) ? d : null;
}
