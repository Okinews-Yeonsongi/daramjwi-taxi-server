import { getAuthUser } from "@/lib/supabase/user";
import { json, apiError, readJson } from "@/lib/api/http";
import { isValidDateString, isWithinBookingWindow, isSlotInFuture } from "@/lib/api/time";

// SQL 함수가 던지는 에러코드 → 사용자 친화 한글 메시지
const ERROR_MAP: Record<string, { msg: string; status: number }> = {
  FORBIDDEN: { msg: "권한이 없어요.", status: 403 },
  INVALID_PERSONS: { msg: "인원은 1~4명이에요.", status: 400 },
  INVALID_HOUR: { msg: "운행 시간이 아니에요.", status: 400 },
  INVALID_LOCATION: { msg: "장소 정보가 올바르지 않아요.", status: 400 },
  SAME_CATEGORY: { msg: "출발지와 도착지는 서로 다른 지역이어야 해요.", status: 400 },
  NO_VEHICLE: { msg: "방금 다른 분이 예약하셨어요. 다시 선택해 주세요.", status: 409 },
};

type Body = {
  date?: string;
  hour?: number;
  departure_id?: number;
  arrival_id?: number;
  persons?: number;
};

/**
 * POST /api/reservations   🔒
 * body: { date, hour, departure_id, arrival_id, persons }
 * → 동시성 안전 RPC로 예약 생성(대기 상태). 차량은 자동 배정됩니다.
 */
export async function POST(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const body = await readJson<Body>(request);
  if (!body) return apiError("요청 형식이 올바르지 않아요.", 400);
  const { date, hour, departure_id, arrival_id, persons } = body;

  // 입력 검증 (친절한 에러를 먼저 주기 위해 API 단에서 1차 검사)
  if (!date || !isValidDateString(date)) return apiError("날짜를 선택해 주세요.", 400);
  if (typeof hour !== "number") return apiError("시간을 선택해 주세요.", 400);
  if (typeof departure_id !== "number" || typeof arrival_id !== "number")
    return apiError("출발지·도착지를 선택해 주세요.", 400);
  if (typeof persons !== "number" || persons < 1 || persons > 4)
    return apiError("인원은 1~4명이에요.", 400);
  if (!isWithinBookingWindow(date)) return apiError("신청은 오늘부터 3일 이내만 가능해요.", 400);
  if (!isSlotInFuture(date, hour)) return apiError("이미 지난 시간이에요. 다른 시간을 선택해 주세요.", 400);

  const { data, error } = await auth.supabase.rpc("create_reservation_atomic", {
    p_user_id: auth.user.id,
    p_date: date,
    p_hour: hour,
    p_departure_id: departure_id,
    p_arrival_id: arrival_id,
    p_persons: persons,
  });

  if (error) {
    const key = Object.keys(ERROR_MAP).find((k) => error.message.includes(k));
    if (key) {
      const m = ERROR_MAP[key];
      return apiError(m.msg, m.status, key);
    }
    console.error("[reservations POST] rpc 실패:", error.message);
    return apiError("예약에 실패했어요. 잠시 후 다시 시도해 주세요.", 500);
  }

  return json({ reservation: data }, 201);
}
