import { requireAdmin } from "@/lib/api/admin";
import { json, apiError } from "@/lib/api/http";

/**
 * GET /api/admin/profiles   🔒(admin)
 * 주민 목록 + 확정 운행 누적 횟수(confirmed_count).
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { db } = guard;

  const [profRes, confRes] = await Promise.all([
    db.from("profiles").select("id, phone, name, role, status, created_at").order("created_at", { ascending: true }),
    db.from("reservations").select("user_id").eq("status", "confirmed"),
  ]);

  if (profRes.error) {
    console.error("[admin profiles] 조회 실패:", profRes.error.message);
    return apiError("주민 목록을 불러오지 못했어요.", 500);
  }

  const countByUser = new Map<string, number>();
  for (const row of confRes.data ?? []) {
    if (!row.user_id) continue; // 전화예약(비회원)은 프로필이 없으므로 제외
    countByUser.set(row.user_id, (countByUser.get(row.user_id) ?? 0) + 1);
  }

  const profiles = (profRes.data ?? []).map((p) => ({
    ...p,
    confirmed_count: countByUser.get(p.id) ?? 0,
  }));

  return json({ profiles });
}
