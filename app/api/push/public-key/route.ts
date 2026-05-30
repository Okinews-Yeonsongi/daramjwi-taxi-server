import { json } from "@/lib/api/http";

/**
 * GET /api/push/public-key
 * 프론트가 푸시 구독 시 사용할 VAPID 공개키.
 * 로그인 불필요 (공개 정보).
 */
export async function GET() {
  return json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? "" });
}
