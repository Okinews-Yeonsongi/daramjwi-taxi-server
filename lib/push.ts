// 웹 푸시 발송 유틸.
// VAPID 키는 환경변수로 주입. notify.ts 와 연동되어 알림 트리거 시 자동 발송.

import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

const PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:contact@daramjwi.local";

let configured = false;
function ensureConfigured() {
  if (configured) return;
  if (!PUBLIC_KEY || !PRIVATE_KEY) {
    throw new Error("VAPID 키가 설정되지 않았어요. (.env: VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY)");
  }
  webpush.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
  configured = true;
}

export type PushPayload = {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string; // 알림 클릭 시 열 URL
  tag?: string; // 같은 tag면 기존 알림 덮어쓰기
};

/** 한 사용자의 모든 구독에 푸시 발송. 실패한 구독(410 등)은 자동 정리. */
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<{ sent: number; removed: number }> {
  if (!userId) return { sent: 0, removed: 0 };
  ensureConfigured();

  const admin = createAdminClient();
  const { data: subs, error } = await admin
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (error) {
    console.error("[push] 구독 조회 실패:", error.message);
    return { sent: 0, removed: 0 };
  }
  if (!subs || subs.length === 0) return { sent: 0, removed: 0 };

  let sent = 0;
  const deadIds: number[] = [];

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60 * 24 } // 24시간 동안 푸시 서버가 보관
        );
        sent += 1;
      } catch (e: unknown) {
        const status = (e as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // 만료/제거된 구독 → DB에서 삭제
          deadIds.push(s.id);
        } else {
          console.warn("[push] 발송 실패(무시):", (e as Error).message);
        }
      }
    })
  );

  if (deadIds.length) {
    await admin.from("push_subscriptions").delete().in("id", deadIds);
  }
  return { sent, removed: deadIds.length };
}

/** 기사님(admin role) 전원에게 발송 — 주민이 확정건을 취소한 경우 등 */
export async function sendPushToAllAdmins(payload: PushPayload): Promise<number> {
  ensureConfigured();
  const admin = createAdminClient();
  const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin");
  if (!admins) return 0;
  let total = 0;
  for (const a of admins) {
    const r = await sendPushToUser(a.id, payload);
    total += r.sent;
  }
  return total;
}
