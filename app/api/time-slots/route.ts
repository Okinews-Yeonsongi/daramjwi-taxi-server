import { createAnonClient } from "@/lib/supabase/anon";
import { json, apiError } from "@/lib/api/http";

/**
 * GET /api/time-slots
 * 운행 시간 슬롯(9~18시) 목록을 시간순으로 반환.
 * 로그인 불필요(마스터 데이터).
 *
 * 응답: { timeSlots: [ { hour: 9, label: "오전 9시" }, ... ] }
 */
export async function GET() {
  const supabase = createAnonClient();
  const { data, error } = await supabase
    .from("time_slots")
    .select("hour, label")
    .order("hour", { ascending: true });

  if (error) {
    console.error("[time-slots] 조회 실패:", error.message);
    return apiError("시간 목록을 불러오지 못했어요.", 500);
  }

  return json({ timeSlots: data ?? [] });
}
