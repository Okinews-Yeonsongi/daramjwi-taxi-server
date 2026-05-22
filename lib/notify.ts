// 알림(SMS) 발송 자리.
// 실제 발송(CoolSMS 연결)은 Phase 8에서 붙입니다. 지금은 서버 로그로 대체하며,
// 알림이 실패해도 본 기능(예약/취소)에는 영향을 주지 않도록 호출부에서 try/catch 합니다.

type SelfCancelInfo = {
  residentName: string;
  date: string;
  hour: number;
  departureName: string;
  arrivalName: string;
  persons: number;
};

/** 주민이 '확정된' 예약을 본인 취소했을 때 → 이장님께 알림 */
export async function notifyAdminSelfCancel(info: SelfCancelInfo): Promise<void> {
  // TODO(Phase 8): CoolSMS로 이장님 번호에 실제 발송
  console.log(
    `[SMS-STUB→이장님] ${info.residentName}님이 ${info.date} ${info.hour}시 예약을 취소했어요. ` +
      `노선: ${info.departureName}→${info.arrivalName}, 인원 ${info.persons}명.`
  );
}
