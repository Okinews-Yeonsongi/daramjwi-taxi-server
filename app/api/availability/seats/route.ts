import { getAuthUser } from "@/lib/supabase/user";
import { json, apiError } from "@/lib/api/http";
import { isValidDateString, isWithinBookingWindow, isSlotInFuture } from "@/lib/api/time";

const ORIGINS = ["cheongsanmyeon", "eupnae"];

/**
 * GET /api/availability/seats?date=YYYY-MM-DD&hour=10&origin=cheongsanmyeon   🔒
 * 인원 선택 단계용 — 그 시간대에 한 번에 신청 가능한 최대 인원(잔여석).
 *
 * 응답: { date, origin, hour, remaining, maxPersons, available }
 */
export async function GET(request: Request) {
  const auth = await getAuthUser(request);
  if (!auth) return apiError("로그인이 필요해요.", 401);

  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  const origin = url.searchParams.get("origin") ?? "";
  const hour = Number(url.searchParams.get("hour"));

  if (!isValidDateString(date)) return apiError("날짜 형식이 올바르지 않아요.", 400);
  if (!ORIGINS.includes(origin)) return apiError("출발 지역이 올바르지 않아요.", 400);
  if (!Number.isInteger(hour) || hour < 9 || hour > 18) return apiError("시간이 올바르지 않아요.", 400);
  if (!isWithinBookingWindow(date)) return apiError("신청은 오늘부터 7일 이내만 가능해요.", 400);

  const { data, error } = await auth.supabase.rpc("get_availability", {
    p_date: date,
    p_origin: origin,
  });
  if (error) {
    console.error("[seats] rpc 실패:", error.message);
    return apiError("잔여석을 불러오지 못했어요.", 500);
  }

  const row = (data ?? []).find((r) => r.hour === hour);
  const future = isSlotInFuture(date, hour);
  const remaining = row && future ? row.remaining : 0;

  return json({
    date,
    origin,
    hour,
    remaining,
    maxPersons: remaining,
    available: remaining > 0,
  });
}
