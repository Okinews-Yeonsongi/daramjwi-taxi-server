import { getAuthUser } from "@/lib/supabase/user";
import { json, apiError } from "@/lib/api/http";
import { isValidDateString, isWithinBookingWindow, isSlotInFuture } from "@/lib/api/time";

const ORIGINS = ["cheongsanmyeon", "eupnae"];

/**
 * GET /api/availability?date=YYYY-MM-DD&origin=cheongsanmyeon   🔒
 * 해당 날짜+출발지의 시간대별 잔여석/마감 여부.
 *
 * 응답: { date, origin, slots: [ { hour, remaining, available, isPast }, ... ] }
 */
export async function GET(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  const origin = url.searchParams.get("origin") ?? "";

  if (!isValidDateString(date)) return apiError("날짜 형식이 올바르지 않아요. (YYYY-MM-DD)", 400);
  if (!ORIGINS.includes(origin)) return apiError("출발 지역이 올바르지 않아요.", 400);
  if (!isWithinBookingWindow(date)) return apiError("신청은 오늘부터 3일 이내만 가능해요.", 400);

  const { data, error } = await auth.supabase.rpc("get_availability", {
    p_date: date,
    p_origin: origin,
  });
  if (error) {
    console.error("[availability] rpc 실패:", error.message);
    return apiError("가용성을 불러오지 못했어요.", 500);
  }

  const slots = (data ?? []).map((row) => {
    const future = isSlotInFuture(date, row.hour);
    const remaining = future ? row.remaining : 0; // 지난 시간은 마감 처리
    return { hour: row.hour, remaining, available: remaining > 0, isPast: !future };
  });

  return json({ date, origin, slots });
}
