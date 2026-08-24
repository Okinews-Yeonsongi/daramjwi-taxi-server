import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthUser } from "@/lib/supabase/user";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiError } from "@/lib/api/http";
import type { Database } from "@/lib/supabase/types";

type AuthCtx = NonNullable<Awaited<ReturnType<typeof getAuthUser>>>;
type ReservationRow = Database["public"]["Tables"]["reservations"]["Row"];

/**
 * 관리자(기사님) 권한 확인.
 * 성공: { auth, db }  (db는 service_role 클라이언트 = 마을 전체 접근/수정)
 * 실패: { error: Response }
 */
export async function requireAdmin(
  request: Request
): Promise<
  | { error: Response }
  | { auth: AuthCtx; db: SupabaseClient<Database>; vehicleId: number | null }
> {
  const auth = await getAuthUser(request);
  if (!auth) return { error: apiError("로그인이 필요해요.", 401) };

  const { data: prof } = await auth.supabase
    .from("profiles")
    .select("role, vehicle_id")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (!prof || prof.role !== "admin") {
    return { error: apiError("관리자 권한이 필요해요.", 403) };
  }
  return { auth, db: createAdminClient(), vehicleId: prof.vehicle_id ?? null };
}

/** 알림 문구에 쓸 주민 이름/전화 + 출발·도착 장소명 + 배정 차량번호 조회 */
export async function loadNotifyParties(
  db: SupabaseClient<Database>,
  r: ReservationRow
) {
  const { data: locs } = await db
    .from("locations")
    .select("id, name")
    .in("id", [r.departure_location_id, r.arrival_location_id]);
  const nameOf = (lid: number) => locs?.find((l) => l.id === lid)?.name ?? "";

  // 전화예약(비회원)은 guest 정보, 회원은 프로필 정보 사용
  let residentName = r.guest_name ?? "주민";
  let residentPhone = r.guest_phone ?? "";
  if (r.user_id) {
    const { data: prof } = await db
      .from("profiles")
      .select("name, phone")
      .eq("id", r.user_id)
      .maybeSingle();
    residentName = prof?.name ?? residentName;
    residentPhone = prof?.phone ?? residentPhone;
  }

  // 배정 차량 번호판 (없으면 A/B 코드)
  let vehiclePlate: string | null = null;
  let vehicleCode: string | null = null;
  if (r.vehicle_id) {
    const { data: v } = await db
      .from("vehicles")
      .select("code, plate_number")
      .eq("id", r.vehicle_id)
      .maybeSingle();
    vehiclePlate = v?.plate_number ?? null;
    vehicleCode = v?.code ?? null;
  }

  return {
    residentName,
    residentPhone,
    departureName: nameOf(r.departure_location_id),
    arrivalName: nameOf(r.arrival_location_id),
    date: r.reservation_date,
    hour: r.hour,
    minute: r.departure_minute,
    userId: r.user_id ?? undefined,
    vehiclePlate, // 예: "51허 1234"
    vehicleCode,  // 예: "A" / "B" (plate 미등록 시 fallback)
  };
}

/** 사람 식별 키 (회원=user_id, 전화예약=guest_phone) */
export function personKey(r: { user_id: string | null; guest_phone: string | null }): string {
  return r.user_id ? `u:${r.user_id}` : r.guest_phone ? `g:${r.guest_phone}` : "";
}

/**
 * 이번 달 "사람별 확정 탑승 횟수" 맵 (item6: 이름 옆 월별 횟수).
 * 회원/전화예약 모두 사람 단위로 집계. (확정된 것만)
 */
export async function monthlyConfirmedCountByPerson(
  db: SupabaseClient<Database>,
  anyDateInMonth: string
): Promise<Map<string, number>> {
  const { start, nextStart } = monthBounds(anyDateInMonth);
  const { data } = await db
    .from("reservations")
    .select("user_id, guest_phone")
    .eq("status", "confirmed")
    .gte("reservation_date", start)
    .lt("reservation_date", nextStart);
  const map = new Map<string, number>();
  for (const r of data ?? []) {
    const key = personKey(r);
    if (key) map.set(key, (map.get(key) ?? 0) + 1);
  }
  return map;
}

/**
 * 확정 통계 — "운행 횟수"와 "총 탑승 인원" 동시 계산.
 *   runs       = (날짜,시각,차량) 단위 거리(합승 1회로 카운트)
 *   passengers = 확정 예약 persons 합 (합승 포함, 사람×운행 단위)
 */
export async function confirmedStats(
  db: SupabaseClient<Database>,
  range: { date: string } | { start: string; nextStart: string }
): Promise<{ runs: number; passengers: number }> {
  let q = db
    .from("reservations")
    .select("reservation_date, hour, vehicle_id, persons")
    .eq("status", "confirmed");
  if ("date" in range) {
    q = q.eq("reservation_date", range.date);
  } else {
    q = q.gte("reservation_date", range.start).lt("reservation_date", range.nextStart);
  }
  const { data, error } = await q;
  if (error) throw error;
  const runs = new Set<string>();
  let passengers = 0;
  for (const r of data ?? []) {
    runs.add(`${r.reservation_date}|${r.hour}|${r.vehicle_id}`);
    passengers += r.persons;
  }
  return { runs: runs.size, passengers };
}

/**
 * 확정된 "운행 횟수"를 셉니다 (한도 4회/112회의 기준).
 * 운행 1회 = (날짜, 시각, 차량) 한 묶음. 합승(같은 운행에 여러 명)은 1회로만 계산됩니다.
 */
export async function countConfirmedRuns(
  db: SupabaseClient<Database>,
  range: { date: string } | { start: string; nextStart: string }
): Promise<number> {
  let q = db
    .from("reservations")
    .select("reservation_date, hour, vehicle_id")
    .eq("status", "confirmed");
  if ("date" in range) {
    q = q.eq("reservation_date", range.date);
  } else {
    q = q.gte("reservation_date", range.start).lt("reservation_date", range.nextStart);
  }
  const { data, error } = await q;
  if (error) throw error;
  const runs = new Set<string>();
  for (const r of data ?? []) runs.add(`${r.reservation_date}|${r.hour}|${r.vehicle_id}`);
  return runs.size;
}

/** 'YYYY-MM-DD' → 그 달의 [시작, 다음달 시작] 경계 */
export function monthBounds(dateStr: string) {
  const [y, mo] = dateStr.split("-").map(Number);
  const pad = (n: number) => String(n).padStart(2, "0");
  const nextY = mo === 12 ? y + 1 : y;
  const nextMo = mo === 12 ? 1 : mo + 1;
  return { start: `${y}-${pad(mo)}-01`, nextStart: `${nextY}-${pad(nextMo)}-01` };
}
