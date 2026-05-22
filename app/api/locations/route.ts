import { createAnonClient } from "@/lib/supabase/anon";
import { json, apiError } from "@/lib/api/http";

/**
 * GET /api/locations
 * 활성화된 장소 목록을 카테고리·표시순서로 정렬해 반환.
 * 로그인 불필요(마스터 데이터, RLS에서 누구나 읽기 허용).
 *
 * 응답: { locations: [...], byCategory: { cheongsanmyeon: [...], eupnae: [...] } }
 */
export async function GET() {
  const supabase = createAnonClient();
  const { data, error } = await supabase
    .from("locations")
    .select("id, category, name, emoji, display_order")
    .eq("is_active", true)
    .order("category", { ascending: true })
    .order("display_order", { ascending: true });

  if (error) {
    console.error("[locations] 조회 실패:", error.message);
    return apiError("장소 목록을 불러오지 못했어요.", 500);
  }

  const locations = data ?? [];
  return json({
    locations,
    byCategory: {
      cheongsanmyeon: locations.filter((l) => l.category === "cheongsanmyeon"),
      eupnae: locations.filter((l) => l.category === "eupnae"),
    },
  });
}
