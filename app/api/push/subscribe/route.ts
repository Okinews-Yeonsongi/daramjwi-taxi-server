import { getAuthUser } from "@/lib/supabase/user";
import { json, apiError, readJson } from "@/lib/api/http";

type Body = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
  user_agent?: string;
};

/**
 * POST /api/push/subscribe   🔒
 * 프론트의 PushSubscription을 그대로 받아 저장.
 * body: { endpoint, keys: { p256dh, auth }, user_agent? }
 */
export async function POST(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const body = await readJson<Body>(request);
  if (!body?.endpoint || !body.keys?.p256dh || !body.keys?.auth) {
    return apiError("푸시 구독 정보가 올바르지 않아요.", 400);
  }

  // 같은 endpoint면 덮어쓰기 (브라우저당 1개)
  const { error } = await auth.supabase.from("push_subscriptions").upsert(
    {
      user_id: auth.user.id,
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      user_agent: body.user_agent ?? null,
    },
    { onConflict: "endpoint" }
  );

  if (error) {
    console.error("[push subscribe] 저장 실패:", error.message);
    return apiError("구독 저장에 실패했어요.", 500);
  }
  return json({ ok: true });
}

/**
 * DELETE /api/push/subscribe?endpoint=...   🔒
 * 구독 해지.
 */
export async function DELETE(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const url = new URL(request.url);
  const endpoint = url.searchParams.get("endpoint");
  if (!endpoint) return apiError("endpoint 파라미터가 필요해요.", 400);

  await auth.supabase.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", auth.user.id);
  return json({ ok: true });
}
