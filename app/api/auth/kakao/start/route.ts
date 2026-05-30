import { kakaoAuthorizeUrl } from "@/lib/api/kakao";
import { randomBytes } from "crypto";

/**
 * GET /api/auth/kakao/start?next=/dev-console.html
 * 카카오 OAuth 시작 — 카카오 로그인 페이지로 리다이렉트.
 * `next` 쿼리는 콜백 후 돌아갈 경로 (default: /).
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = url.searchParams.get("next") ?? "/";
  // state에 next 경로를 담아 콜백에서 복원 (간단 base64)
  const nonce = randomBytes(8).toString("hex");
  const state = Buffer.from(JSON.stringify({ next, nonce })).toString("base64url");

  const target = kakaoAuthorizeUrl(state);
  return Response.redirect(target, 302);
}
