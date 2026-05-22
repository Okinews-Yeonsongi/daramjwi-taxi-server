import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * CORS 처리.
 * 프론트엔드(daramjwi-taxi-client)가 다른 주소(origin)에서 이 API를 호출하므로,
 * 브라우저가 막지 않도록 허용 헤더를 붙입니다.
 * 인증은 쿠키가 아니라 Bearer 토큰을 쓰므로 credentials는 불필요합니다.
 *
 * 허용 주소는 환경변수 ALLOWED_ORIGINS(쉼표 구분)로 지정. 미설정 시 모두 허용("*").
 */
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? "*")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowAll = ALLOWED.includes("*");
  const allowOrigin = allowAll
    ? "*"
    : origin && ALLOWED.includes(origin)
      ? origin
      : (ALLOWED[0] ?? "*");
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export function middleware(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  // 브라우저 사전요청(preflight)에 즉시 응답
  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  const res = NextResponse.next();
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = { matcher: "/api/:path*" };
