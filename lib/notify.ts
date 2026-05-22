// 알림(SMS) 발송 자리.
// 실제 발송(CoolSMS 연결)은 Phase 8에서 붙입니다. 지금은 서버 로그로 대체하며,
// 알림이 실패해도 본 기능에는 영향을 주지 않도록 호출부에서 try/catch 합니다.
// 문구는 PROJECT_SPEC 9.2 템플릿 기준.

type Party = {
  residentName: string;
  residentPhone: string;
  date: string;
  hour: number;
  departureName: string;
  arrivalName: string;
};

/** 이장님 확정 → 주민에게 */
export async function notifyResidentConfirmed(info: Party): Promise<void> {
  // TODO(Phase 8): CoolSMS로 주민 번호에 실제 발송
  console.log(
    `[SMS-STUB→${info.residentPhone}] ${info.residentName}님, ${info.date} ${info.hour}시 ` +
      `탑승 예약이 확정되었어요. 출발: ${info.departureName}, 도착: ${info.arrivalName}.`
  );
}

/** 이장님 취소 → 주민에게 (사유 포함) */
export async function notifyResidentCancelled(info: Party & { reason: string }): Promise<void> {
  console.log(
    `[SMS-STUB→${info.residentPhone}] ${info.residentName}님, ${info.date} ${info.hour}시 ` +
      `탑승 예약이 취소되었어요. 사유: ${info.reason}.`
  );
}

/** 주민이 '확정된' 예약을 본인 취소 → 이장님에게 */
export async function notifyAdminSelfCancel(info: {
  residentName: string;
  date: string;
  hour: number;
  departureName: string;
  arrivalName: string;
  persons: number;
}): Promise<void> {
  console.log(
    `[SMS-STUB→이장님] ${info.residentName}님이 ${info.date} ${info.hour}시 예약을 취소했어요. ` +
      `노선: ${info.departureName}→${info.arrivalName}, 인원 ${info.persons}명.`
  );
}
