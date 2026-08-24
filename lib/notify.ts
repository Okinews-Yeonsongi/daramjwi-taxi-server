// 알림 발송.
// 1) 콘솔 로그(스텁) — 항상 출력
// 2) 웹 푸시 — 사용자가 구독해놨으면 실제 발송 (사업자 X, 0원)
// 3) SMS/카카오 알림톡 — 사업자등록 + 솔라피/비즈채널 연동 후 활성화 (미연결)
// 알림 실패가 본 기능(예약/취소)에 영향을 주지 않도록 호출부에서 try/catch 합니다.
// 문구는 PROJECT_SPEC 9.2 템플릿 기준.

import { sendPushToUser, sendPushToAllAdmins, sendPushToVehicleOwner } from "@/lib/push";

type Party = {
  residentName: string;
  residentPhone: string;
  date: string;
  hour: number;
  minute?: number;
  departureName: string;
  arrivalName: string;
};

function timeText(h: number, m?: number): string {
  return m && m > 0 ? `${h}시 ${m}분` : `${h}시`;
}

/** 기사님 확정 → 주민에게 */
export async function notifyResidentConfirmed(info: Party & { userId?: string }): Promise<void> {
  const time = timeText(info.hour, info.minute);
  console.log(
    `[SMS-STUB→${info.residentPhone}] ${info.residentName}님, ${info.date} ${time} ` +
      `탑승 예약이 확정되었어요. 출발: ${info.departureName}, 도착: ${info.arrivalName}.`
  );
  if (info.userId) {
    await sendPushToUser(info.userId, {
      title: "✅ 예약 확정",
      body: `${info.date} ${time} · ${info.departureName} → ${info.arrivalName}`,
      tag: `confirm-${info.date}-${info.hour}`,
      url: "/dev-console.html#/my-reservations",
    }).catch((e) => console.warn("[push] confirm 실패:", (e as Error).message));
  }
}

/** 기사님 취소 → 주민에게 (사유 포함) */
export async function notifyResidentCancelled(info: Party & { reason: string; userId?: string }): Promise<void> {
  const time = timeText(info.hour, info.minute);
  console.log(
    `[SMS-STUB→${info.residentPhone}] ${info.residentName}님, ${info.date} ${time} ` +
      `탑승 예약이 취소되었어요. 사유: ${info.reason}.`
  );
  if (info.userId) {
    await sendPushToUser(info.userId, {
      title: "❌ 예약 취소",
      body: `${info.date} ${time} · 사유: ${info.reason}`,
      tag: `cancel-${info.date}-${info.hour}`,
      url: "/dev-console.html#/my-reservations",
    }).catch((e) => console.warn("[push] cancel 실패:", (e as Error).message));
  }
}

/** 주민이 본인 예약(대기/확정) 취소 → 주민 본인에게 확인 알림 */
export async function notifyResidentSelfCancelled(info: Party & { userId?: string }): Promise<void> {
  const time = timeText(info.hour, info.minute);
  console.log(
    `[SMS-STUB→${info.residentPhone}] ${info.residentName}님, ${info.date} ${time} ` +
      `탑승 예약 취소가 처리되었어요. (${info.departureName}→${info.arrivalName})`
  );
  if (info.userId) {
    await sendPushToUser(info.userId, {
      title: "🗑️ 취소 완료",
      body: `${info.date} ${time} 예약을 취소했어요.`,
      tag: `selfcancel-${info.date}-${info.hour}`,
      url: "/dev-console.html#/my-reservations",
    }).catch((e) => console.warn("[push] self-cancel 실패:", (e as Error).message));
  }
}

/** 주민이 '확정된' 예약을 본인 취소 → 담당 차량 기사님에게 (없으면 전원) */
export async function notifyAdminSelfCancel(info: {
  residentName: string;
  date: string;
  hour: number;
  minute?: number;
  departureName: string;
  arrivalName: string;
  persons: number;
  vehicleId?: number | null; // 담당 기사님만 알림 (없으면 전원 fallback)
}): Promise<void> {
  const time = timeText(info.hour, info.minute);
  console.log(
    `[SMS-STUB→기사님] ${info.residentName}님이 ${info.date} ${time} 예약을 취소했어요. ` +
      `노선: ${info.departureName}→${info.arrivalName}, 인원 ${info.persons}명.`
  );
  await sendPushToVehicleOwner(info.vehicleId ?? null, {
    title: "⚠️ 확정 예약 취소",
    body: `${info.residentName}님 · ${info.date} ${time} · ${info.persons}명 · ${info.departureName}→${info.arrivalName}`,
    tag: `admin-cancel-${info.date}-${info.hour}`,
    url: "/dev-console.html#/admin/waiting",
  }).catch((e) => console.warn("[push] admin notify 실패:", (e as Error).message));
}
