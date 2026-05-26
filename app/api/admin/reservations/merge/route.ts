import { requireAdmin, loadNotifyParties } from "@/lib/api/admin";
import { json, apiError, readJson } from "@/lib/api/http";
import { notifyResidentConfirmed } from "@/lib/notify";

const MERGE_ERRORS: Record<string, { msg: string; status: number }> = {
  MERGE_NEED_TWO: { msg: "두 건 이상 선택해 주세요.", status: 400 },
  MERGE_NOT_ALL_WAITING: { msg: "대기 상태인 예약만 합칠 수 있어요. (이미 처리된 예약 포함됨)", status: 400 },
  MERGE_DATE_MISMATCH: { msg: "같은 날짜의 예약만 합칠 수 있어요.", status: 400 },
  MERGE_CATEGORY_MISMATCH: { msg: "같은 출발 지역끼리만 합칠 수 있어요.", status: 400 },
  MERGE_HOUR_RANGE: { msg: "1시간 차이 이내의 예약만 합칠 수 있어요.", status: 400 },
  MERGE_OVER_CAPACITY: { msg: "합치면 4명을 넘어가요.", status: 400 },
  INVALID_HOUR: { msg: "운행 시간이 아니에요. (9~18시)", status: 400 },
  INVALID_MINUTE: { msg: "분은 10분 단위(0/10/20/30/40/50)만 가능해요.", status: 400 },
  NO_VEHICLE: { msg: "그 시각에 빈 차량이 없어요.", status: 409 },
  DAILY_LIMIT: { msg: "그 날의 운행 한도(4회)를 초과해요.", status: 409 },
  MONTHLY_LIMIT: { msg: "이번 달 운행 한도(112회)를 초과해요.", status: 409 },
};

type Body = {
  reservation_ids?: number[];
  new_hour?: number;
  new_minute?: number;
};

/**
 * POST /api/admin/reservations/merge   🔒(admin)
 * 선택한 대기 예약들을 같은 차+같은 새 시각(10분 단위)으로 묶어 자동 확정.
 * body: { reservation_ids: number[], new_hour: number, new_minute: number }
 * 성공 시 각 주민에게 확정 알림 발송.
 */
export async function POST(request: Request) {
  const guard = await requireAdmin(request);
  if ("error" in guard) return guard.error;
  const { auth, db } = guard;

  const body = await readJson<Body>(request);
  if (!body) return apiError("요청 형식이 올바르지 않아요.", 400);

  const ids = body.reservation_ids;
  const hour = body.new_hour;
  const minute = body.new_minute;

  if (!Array.isArray(ids) || ids.length < 2 || !ids.every((x) => Number.isInteger(x) && x > 0)) {
    return apiError("두 건 이상의 예약을 선택해 주세요.", 400);
  }
  if (typeof hour !== "number" || !Number.isInteger(hour)) {
    return apiError("새 시각의 '시'를 선택해 주세요.", 400);
  }
  if (typeof minute !== "number" || ![0, 10, 20, 30, 40, 50].includes(minute)) {
    return apiError("분은 10분 단위(0/10/20/30/40/50)만 가능해요.", 400);
  }

  const { data, error } = await db.rpc("merge_reservations_admin", {
    p_reservation_ids: ids,
    p_new_hour: hour,
    p_new_minute: minute,
    p_confirmed_by: auth.user.id,
  });

  if (error) {
    const key = Object.keys(MERGE_ERRORS).find((k) => error.message.includes(k));
    if (key) {
      const m = MERGE_ERRORS[key];
      return apiError(m.msg, m.status, key);
    }
    console.error("[admin merge] rpc 실패:", error.message);
    return apiError("합치기에 실패했어요. 잠시 후 다시 시도해 주세요.", 500);
  }

  // 합쳐진 각 예약의 주민에게 확정 알림 (스텁; 실패해도 합치기는 유효)
  const merged = data ?? [];
  for (const r of merged) {
    try {
      const parties = await loadNotifyParties(db, r);
      await notifyResidentConfirmed(parties);
    } catch (e) {
      console.error("[admin merge] 알림 스텁 실패(무시):", (e as Error).message);
    }
  }

  return json({ reservations: merged }, 200);
}
