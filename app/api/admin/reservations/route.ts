import {
  requireAdmin,
  monthlyConfirmedCountByPerson,
  personKey,
} from "@/lib/api/admin";
import { json, apiError, readJson } from "@/lib/api/http";
import { normalizeKoreanMobile } from "@/lib/api/phone";
import { isValidDateString, isWithinBookingWindow, isSlotInFuture, kstTodayString } from "@/lib/api/time";
import type { ReservationStatus } from "@/lib/supabase/types";

/** 화면 표시용 상태(완료 자동 분류 포함) */
function effectiveStatus(status: ReservationStatus, date: string, hour: number): ReservationStatus | "completed" {
  if (status === "cancelled") return "cancelled";
  if (!isSlotInFuture(date, hour)) return "completed"; // 지난 슬롯 → 완료
  return status; // 미래는 원래 상태(waiting/confirmed)
}

const STATUSES: ReservationStatus[] = ["waiting", "confirmed", "cancelled", "completed"];

const BOOK_ERRORS: Record<string, { msg: string; status: number }> = {
  INVALID_GUEST: { msg: "이름과 연락처를 입력해 주세요.", status: 400 },
  INVALID_PERSONS: { msg: "인원은 1~4명이에요.", status: 400 },
  INVALID_HOUR: { msg: "운행 시간이 아니에요.", status: 400 },
  INVALID_LOCATION: { msg: "장소 정보가 올바르지 않아요.", status: 400 },
  SAME_CATEGORY: { msg: "출발지와 도착지는 서로 다른 지역이어야 해요.", status: 400 },
  NO_VEHICLE: { msg: "그 시간은 마감이에요. 다른 시간을 선택해 주세요.", status: 409 },
  FORBIDDEN: { msg: "관리자 권한이 필요해요. (DB 함수 권한 설정 확인)", status: 403 },
};

/**
 * GET /api/admin/reservations?status=waiting&date=YYYY-MM-DD   🔒(admin)
 * 예약 필터 조회. 신청자(회원/전화예약) 이름·전화, 장소명, 차량코드, 그리고
 * 신청자의 "이번 달 확정 탑승 횟수(monthly_confirmed)"까지 포함.
 */
export async function GET(request: Request) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { db } = guard;

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const date = url.searchParams.get("date");
  const includePast = url.searchParams.get("include_past") === "1"; // 과거 데이터까지 보고 싶을 때만
  if (status && !STATUSES.includes(status as ReservationStatus)) return apiError("status 값이 올바르지 않아요.", 400);
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return apiError("date 형식이 올바르지 않아요.", 400);

  let q = db
    .from("reservations")
    .select("*")
    .order("reservation_date", { ascending: true })
    .order("hour", { ascending: true })
    .order("created_at", { ascending: true });
  if (status) q = q.eq("status", status as ReservationStatus);
  if (date) q = q.eq("reservation_date", date);
  // 기본: 오늘 이후만 (과거 신청은 처리 불가). 통계/캘린더용으로는 ?include_past=1 또는 ?date=...
  if (!includePast && !date) q = q.gte("reservation_date", kstTodayString());

  const [resvRes, profRes, locRes, slotRes, vehRes, monthlyMap] = await Promise.all([
    q,
    db.from("profiles").select("id, name, phone"),
    db.from("locations").select("id, name, emoji, category"),
    db.from("time_slots").select("hour, label"),
    db.from("vehicles").select("id, code"),
    monthlyConfirmedCountByPerson(db, kstTodayString()),
  ]);

  if (resvRes.error) {
    console.error("[admin reservations] 조회 실패:", resvRes.error.message);
    return apiError("예약 목록을 불러오지 못했어요.", 500);
  }

  const profMap = new Map((profRes.data ?? []).map((p) => [p.id, p]));
  const locMap = new Map((locRes.data ?? []).map((l) => [l.id, l]));
  const slotMap = new Map((slotRes.data ?? []).map((s) => [s.hour, s.label]));
  const vehMap = new Map((vehRes.data ?? []).map((v) => [v.id, v.code]));

  const reservations = (resvRes.data ?? []).map((r) => {
    const p = r.user_id ? profMap.get(r.user_id) : undefined;
    // 회원이면 프로필, 전화예약이면 guest 정보
    const resident = {
      id: r.user_id,
      name: p?.name ?? r.guest_name ?? null,
      phone: p?.phone ?? r.guest_phone ?? null,
      is_guest: r.user_id == null,
    };
    const baseLabel = slotMap.get(r.hour) ?? null;
    const timeLabel = r.departure_minute > 0 && baseLabel ? `${baseLabel} ${r.departure_minute}분` : baseLabel;
    return {
      id: r.id,
      reservation_date: r.reservation_date,
      hour: r.hour,
      departure_minute: r.departure_minute,
      time_label: timeLabel,
      persons: r.persons,
      status: r.status,
      effective_status: effectiveStatus(r.status, r.reservation_date, r.hour), // 지난 슬롯은 자동 '완료'
      resident,
      monthly_confirmed: monthlyMap.get(personKey(r)) ?? 0, // 이번 달 확정 탑승 횟수
      departure: locMap.get(r.departure_location_id) ?? null,
      arrival: locMap.get(r.arrival_location_id) ?? null,
      vehicle_code: r.vehicle_id != null ? (vehMap.get(r.vehicle_id) ?? null) : null,
      cancel_reason: r.cancel_reason,
      confirmed_at: r.confirmed_at,
      cancelled_at: r.cancelled_at,
      created_at: r.created_at,
    };
  });

  return json({ reservations });
}

type GuestBookingBody = {
  name?: string;
  phone?: string;
  date?: string;
  hour?: number;
  departure_id?: number;
  arrival_id?: number;
  persons?: number;
};

/**
 * POST /api/admin/reservations   🔒(admin)
 * 기사님이 전화 신청을 대신 입력 (비회원). 매번 이름+연락처 입력 (저장 안 함).
 * body: { name, phone, date, hour, departure_id, arrival_id, persons }
 */
export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { db } = guard;

  const body = await readJson<GuestBookingBody>(request);
  if (!body) return apiError("요청 형식이 올바르지 않아요.", 400);
  const { name, phone, date, hour, departure_id, arrival_id, persons } = body;

  const trimmedName = name?.trim();
  if (!trimmedName) return apiError("이름을 입력해 주세요.", 400);
  const localPhone = phone ? normalizeKoreanMobile(phone) : null;
  if (!localPhone) return apiError("올바른 휴대폰 번호를 입력해 주세요. (예: 010-1234-5678)", 400);
  if (!date || !isValidDateString(date)) return apiError("날짜를 선택해 주세요.", 400);
  if (typeof hour !== "number") return apiError("시간을 선택해 주세요.", 400);
  if (typeof departure_id !== "number" || typeof arrival_id !== "number")
    return apiError("출발지·도착지를 선택해 주세요.", 400);
  if (typeof persons !== "number" || persons < 1 || persons > 4)
    return apiError("인원은 1~4명이에요.", 400);
  if (!isWithinBookingWindow(date)) return apiError("신청은 오늘부터 7일 이내만 가능해요.", 400);
  if (!isSlotInFuture(date, hour)) return apiError("이미 지난 시간이에요. 다른 시간을 선택해 주세요.", 400);

  // 회원 자동 매칭: 같은 전화번호의 회원 있으면 그 user_id로 회원 예약 저장
  const { data: matchedUser } = await db
    .from("profiles")
    .select("id")
    .eq("phone", localPhone)
    .maybeSingle();

  const { data, error } = await db.rpc("create_guest_reservation_atomic", {
    p_guest_name: trimmedName,
    p_guest_phone: localPhone,
    p_date: date,
    p_hour: hour,
    p_departure_id: departure_id,
    p_arrival_id: arrival_id,
    p_persons: persons,
    p_user_id: matchedUser?.id ?? null, // 매칭되면 회원 예약, 안 되면 guest
  });

  if (error) {
    const key = Object.keys(BOOK_ERRORS).find((k) => error.message.includes(k));
    if (key) {
      const m = BOOK_ERRORS[key];
      return apiError(m.msg, m.status, key);
    }
    console.error("[admin reservations POST] rpc 실패:", error.message);
    return apiError("예약에 실패했어요. 잠시 후 다시 시도해 주세요.", 500);
  }

  return json({ reservation: data }, 201);
}
