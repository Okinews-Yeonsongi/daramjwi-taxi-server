import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/supabase/user";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError } from "@/lib/api/http";
import type { Database } from "@/lib/supabase/types";

type AuthCtx = NonNullable<Awaited<ReturnType<typeof getAuthUser>>>;
type ReservationRow = Database["public"]["Tables"]["reservations"]["Row"];

/**
 * 관리자(이장님) 권한 확인.
 * 성공: { auth, db }  (db는 service_role 클라이언트 = 마을 전체 접근/수정)
 * 실패: { error: Response }
 */
export async function requireAdmin(
  request: Request
): Promise<{ error: Response } | { auth: AuthCtx; db: SupabaseClient<Database> }> {
  const auth = await getAuthUser(request);
  if (!auth) return { error: apiError("로그인이 필요해요.", 401) };

  const { data: prof } = await auth.supabase
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (!prof || prof.role !== "admin") {
    return { error: apiError("관리자 권한이 필요해요.", 403) };
  }
  return { auth, db: createAdminClient() };
}

/** 알림 문구에 쓸 주민 이름/전화 + 출발·도착 장소명 조회 */
export async function loadNotifyParties(
  db: SupabaseClient<Database>,
  r: ReservationRow
) {
  const [{ data: prof }, { data: locs }] = await Promise.all([
    db.from("profiles").select("name, phone").eq("id", r.user_id).maybeSingle(),
    db.from("locations").select("id, name").in("id", [r.departure_location_id, r.arrival_location_id]),
  ]);
  const nameOf = (lid: number) => locs?.find((l) => l.id === lid)?.name ?? "";
  return {
    residentName: prof?.name ?? "주민",
    residentPhone: prof?.phone ?? "",
    departureName: nameOf(r.departure_location_id),
    arrivalName: nameOf(r.arrival_location_id),
    date: r.reservation_date,
    hour: r.hour,
  };
}

/** 'YYYY-MM-DD' → 그 달의 [시작, 다음달 시작] 경계 */
export function monthBounds(dateStr: string) {
  const [y, mo] = dateStr.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const nextY = mo === 12 ? y + 1 : y;
  const nextMo = mo === 12 ? 1 : mo + 1;
  return { start: `${y}-${pad(mo)}-01`, nextStart: `${nextY}-${pad(nextMo)}-01` };
}
