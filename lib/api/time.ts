/**
 * 한국 시간(KST, UTC+9, 서머타임 없음) 기준 날짜/시간 유틸.
 * 서버는 보통 UTC로 도므로, 신청 가능 기간/미래 시간 판정은 KST로 계산해야 합니다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** 오늘(KST) 'YYYY-MM-DD' */
export function kstTodayString(): string {
  const d = new Date(Date.now() + KST_OFFSET_MS);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateOnlyEpoch(dateStr: string): number {
  const [y, m, day] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

/** dateStr이 오늘 ~ 오늘+2 (KST) 범위인지 (= 신청 가능 3일 창: 오늘 포함) */
export function isWithinBookingWindow(dateStr: string): boolean {
  if (!isValidDateString(dateStr)) return false;
  const diff = Math.round(
    (dateOnlyEpoch(dateStr) - dateOnlyEpoch(kstTodayString())) / 86400000
  );
  return diff >= 0 && diff <= 2;
}

/** dateStr의 hour시 슬롯이 현재(KST)보다 미래인지 */
export function isSlotInFuture(dateStr: string, hour: number): boolean {
  const [y, m, day] = dateStr.split("-").map(Number);
  // KST hour → UTC: UTC = KST - 9 (Date.UTC가 음수/자리올림 처리)
  const slotUtcMs = Date.UTC(y, m - 1, day, hour - 9, 0, 0);
  return slotUtcMs > Date.now();
}
