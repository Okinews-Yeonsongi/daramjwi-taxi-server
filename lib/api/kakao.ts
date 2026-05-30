// 카카오 OAuth 도우미.
// 비즈앱 없이 닉네임/프사만 동의 받음.

import { createHmac } from "crypto";

export const KAKAO_CLIENT_ID = process.env.KAKAO_REST_API_KEY ?? "";
export const KAKAO_REDIRECT_URI = process.env.KAKAO_REDIRECT_URI ?? "";
const INTERNAL_PASSWORD_SECRET = process.env.INTERNAL_PASSWORD_SECRET ?? "fallback-dev-secret-do-not-use-in-prod";

export type KakaoUserInfo = {
  id: number; // 카카오 회원번호 (고유)
  kakao_account?: {
    profile?: {
      nickname?: string;
      profile_image_url?: string;
      thumbnail_image_url?: string;
    };
  };
};

/** Step 1: 카카오 로그인 페이지로 보낼 URL 생성 */
export function kakaoAuthorizeUrl(state: string): string {
  if (!KAKAO_CLIENT_ID || !KAKAO_REDIRECT_URI) {
    throw new Error("KAKAO_REST_API_KEY 또는 KAKAO_REDIRECT_URI 미설정");
  }
  const u = new URL("https://kauth.kakao.com/oauth/authorize");
  u.searchParams.set("client_id", KAKAO_CLIENT_ID);
  u.searchParams.set("redirect_uri", KAKAO_REDIRECT_URI);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "profile_nickname,profile_image");
  u.searchParams.set("state", state);
  return u.toString();
}

/** Step 2: code → access_token */
export async function exchangeCodeForToken(code: string): Promise<string> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: KAKAO_CLIENT_ID,
    redirect_uri: KAKAO_REDIRECT_URI,
    code,
  });
  const res = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`카카오 토큰 교환 실패: ${res.status} ${txt}`);
  }
  const json = await res.json();
  if (!json.access_token) throw new Error("카카오 access_token 누락");
  return json.access_token as string;
}

/** Step 3: access_token → 사용자 정보 */
export async function fetchKakaoUserInfo(kakaoAccessToken: string): Promise<KakaoUserInfo> {
  const res = await fetch("https://kapi.kakao.com/v2/user/me", {
    headers: { Authorization: `Bearer ${kakaoAccessToken}` },
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`카카오 사용자 정보 조회 실패: ${res.status} ${txt}`);
  }
  return (await res.json()) as KakaoUserInfo;
}

/** 카카오 ID로부터 결정적 비밀번호 생성 (사용자 보이지 않음, 내부 Supabase 로그인용) */
export function derivePasswordFromKakaoId(kakaoId: number | string): string {
  return createHmac("sha256", INTERNAL_PASSWORD_SECRET)
    .update(`kakao:${kakaoId}`)
    .digest("hex");
}

/** 카카오 ID로부터 합성 이메일 (Supabase Auth 식별용, 사용자 보이지 않음) */
export function syntheticEmail(kakaoId: number | string): string {
  return `kakao_${kakaoId}@daramjwi.local`;
}
