// 알림(SMS·카톡) 발송 자리.
// 실제 발송(CoolSMS/카카오 알림톡 연결)은 Phase 8에서 붙입니다. 지금은 서버 로그로 대체.
// 알림 실패가 본 기능(예약/취소)에 영향을 주지 않도록 호출부에서 try/catch 합니다.
// 문구는 PROJECT_SPEC 9.2 템플릿 기준.

type Party = {
  residentName: string;
  residentPhone: string;
  date: string;
  hour: number;
  minute?: number; // 10분 단위, 기본 0 (기사님 합치기로 조율된 경우만 0이 아님)
  departureName: string;
  arrivalName: string;
};

/** "10시" 또는 "10시 40분" 으로 포맷 */
function timeText(h: number, m?: number): string {
  return m && m > 0 ? `${h}시 ${m}분` : `${h}시`;
}

/** 기사님 확정 → 주민에게 */
export async function notifyResidentConfirmed(info: Party): Promise<void> {
  console.log(
    `[SMS-STUB→${info.residentPhone}] ${info.residentName}님, ${info.date} ${timeText(info.hour, info.minute)} ` +
      `탑승 예약이 확정되었어요. 출발: ${info.departureName}, 도착: ${info.arrivalName}.`
  );
}

/** 기사님 취소 → 주민에게 (사유 포함) */
export async function notifyResidentCancelled(info: Party & { reason: string }): Promise<void> {
  console.log(
    `[SMS-STUB→${info.residentPhone}] ${info.residentName}님, ${info.date} ${timeText(info.hour, info.minute)} ` +
      `탑승 예약이 취소되었어요. 사유: ${info.reason}.`
  );
}

/** 주민이 본인 예약(대기/확정) 취소 → 주민 본인에게 확인 알림 */
export async function notifyResidentSelfCancelled(info: Party): Promise<void> {
  console.log(
    `[SMS-STUB→${info.residentPhone}] ${info.residentName}님, ${info.date} ${timeText(info.hour, info.minute)} ` +
      `탑승 예약 취소가 처리되었어요. (${info.departureName}→${info.arrivalName})`
  );
}

/** 주민이 '확정된' 예약을 본인 취소 → 기사님에게 */
export async function notifyAdminSelfCancel(info: {
  residentName: string;
  date: string;
  hour: number;
  minute?: number;
  departureName: string;
  arrivalName: string;
  persons: number;
}): Promise<void> {
  console.log(
    `[SMS-STUB→기사님] ${info.residentName}님이 ${info.date} ${timeText(info.hour, info.minute)} 예약을 취소했어요. ` +
      `노선: ${info.departureName}→${info.arrivalName}, 인원 ${info.persons}명.`
  );
}
