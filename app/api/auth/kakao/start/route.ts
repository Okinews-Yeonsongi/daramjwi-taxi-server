import { kakaoAuthorizeUrl } from "@/lib/api/kakao";
import { randomBytes } from "crypto";

/**
 * GET /api/auth/kakao/start?next=/dev-console.html
 * 카카오 OAuth 시작 — 카카오 로그인 페이지로 리다이렉트.
 * `next` 쿼리는 콜백 후 돌아갈 경로 (default: /).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const next = url.searchParams.get("next") ?? "/";
    const nonce = randomBytes(8).toString("hex");
    const state = Buffer.from(JSON.stringify({ next, nonce })).toString("base64url");
    const target = kakaoAuthorizeUrl(state);
    return Response.redirect(target, 302);
  } catch (e) {
    const msg = (e as Error).message ?? "알 수 없는 오류";
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>카카오 로그인 설정 오류</title>
<h1>🚧 카카오 로그인을 시작할 수 없어요</h1>
<p><strong>원인:</strong> ${escapeHtml(msg)}</p>
<p><strong>해결:</strong> Vercel 환경변수에 <code>KAKAO_REST_API_KEY</code>와 <code>KAKAO_REDIRECT_URI</code>가 설정되어 있는지 확인하세요. 설정 후 재배포 필요.</p>
<p><a href="/dev-console.html">← 콘솔로 돌아가기</a></p>`,
      { status: 500, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
