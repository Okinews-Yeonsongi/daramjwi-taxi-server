import { NextResponse } from "next/server";

/** 성공 JSON 응답 */
export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

/** 에러 JSON 응답 (사용자에게 보여줄 친근한 한글 메시지) */
export function apiError(message: string, status = 400, code?: string) {
  return NextResponse.json({ error: message, code }, { status });
}

/** Authorization: Bearer <token> 헤더에서 토큰만 추출 */
export function getBearerToken(request: Request): string | null {
  const h =
    request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

/** 요청 body를 안전하게 JSON 파싱 (실패 시 null) */
export async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}
