import { NextResponse } from "next/server";

// 서버가 살아있는지 확인하는 헬스체크 엔드포인트.
// 셋업이 잘 됐는지 가장 먼저 확인할 때 사용합니다: GET /api/health
export async function GET() {
  return NextResponse.json({
    status: "ok",
    service: "daramjwi-taxi-server",
    timestamp: new Date().toISOString(),
  });
}
