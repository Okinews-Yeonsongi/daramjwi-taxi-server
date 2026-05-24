// item 5·6 자동 테스트: 전화(비회원) 예약 + 이름 옆 월별 확정 횟수
// 실행: node --env-file=.env.local scripts/test-item56.mjs  (서버가 localhost:3000 에 떠 있어야 함)
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
if (!URL || !SERVICE) { console.error("환경변수 누락"); process.exit(1); }
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });

const GUEST_NAME = "김순례";
const GUEST_PHONE_INPUT = "010-1234-0000";
const GUEST_PHONE = "01012340000"; // 정규화 결과

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { console.log(`  ✅ ${n}`); pass++; } else { console.log(`  ❌ ${n}  ${e}`); fail++; } };
const tomorrow = () => { const d = new Date(Date.now() + 9 * 3600 * 1000 + 24 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; };

async function devToken(role) {
  const res = await fetch(`${BASE}/api/dev/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
  return (await res.json()).access_token;
}
async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await res.json(); } catch { /* */ }
  return { status: res.status, json: j };
}
const guestBook = (token, body) => api("/api/admin/reservations", { method: "POST", token, body });

async function main() {
  const aTok = await devToken("admin");
  const rTok = await devToken("resident");
  const date = tomorrow();
  await admin.from("reservations").delete().eq("guest_phone", GUEST_PHONE); // 정리

  console.log("1) 권한·입력 검증");
  check("토큰 없이 전화예약 → 401", (await guestBook(null, { name: GUEST_NAME, phone: GUEST_PHONE_INPUT, date, hour: 9, departure_id: 1, arrival_id: 4, persons: 2 })).status === 401);
  check("주민 토큰 → 403", (await guestBook(rTok, { name: GUEST_NAME, phone: GUEST_PHONE_INPUT, date, hour: 9, departure_id: 1, arrival_id: 4, persons: 2 })).status === 403);
  check("전화번호 없이 → 400", (await guestBook(aTok, { name: GUEST_NAME, date, hour: 9, departure_id: 1, arrival_id: 4, persons: 2 })).status === 400);
  check("이름 없이 → 400", (await guestBook(aTok, { phone: GUEST_PHONE_INPUT, date, hour: 9, departure_id: 1, arrival_id: 4, persons: 2 })).status === 400);

  console.log("\n2) 전화(비회원) 예약 생성");
  const b1 = await guestBook(aTok, { name: GUEST_NAME, phone: GUEST_PHONE_INPUT, date, hour: 9, departure_id: 1, arrival_id: 4, persons: 2 });
  check("생성 201", b1.status === 201, JSON.stringify(b1.json).slice(0, 150));
  check("guest_name 저장 + user_id 없음(비회원)", b1.json?.reservation?.guest_name === GUEST_NAME && b1.json?.reservation?.user_id == null, JSON.stringify(b1.json?.reservation).slice(0, 150));
  check("전화번호 정규화 저장", b1.json?.reservation?.guest_phone === GUEST_PHONE, b1.json?.reservation?.guest_phone);

  console.log("\n3) 관리자 목록에 게스트로 표시 + 월별횟수 0");
  let list = (await api("/api/admin/reservations?status=waiting", { token: aTok })).json.reservations;
  let item = list.find((x) => x.id === b1.json.reservation.id);
  check("이름=김순례, is_guest=true", item?.resident?.name === GUEST_NAME && item?.resident?.is_guest === true, JSON.stringify(item?.resident));
  check("확정 전 monthly_confirmed=0", item?.monthly_confirmed === 0, `mc=${item?.monthly_confirmed}`);

  console.log("\n4) 확정 → 월별횟수 1");
  const c1 = await api(`/api/admin/reservations/${b1.json.reservation.id}/confirm`, { method: "PATCH", token: aTok });
  check("게스트 예약 확정 200", c1.status === 200, JSON.stringify(c1.json).slice(0, 120));
  list = (await api(`/api/admin/reservations?status=confirmed`, { token: aTok })).json.reservations;
  item = list.find((x) => x.id === b1.json.reservation.id);
  check("확정 후 monthly_confirmed=1", item?.monthly_confirmed === 1, `mc=${item?.monthly_confirmed}`);

  console.log("\n5) 같은 전화로 또 예약+확정 → 월별횟수 2 (전화번호로 집계)");
  const b2 = await guestBook(aTok, { name: GUEST_NAME, phone: GUEST_PHONE_INPUT, date, hour: 14, departure_id: 1, arrival_id: 4, persons: 1 });
  check("2번째 전화예약 201", b2.status === 201);
  await api(`/api/admin/reservations/${b2.json.reservation.id}/confirm`, { method: "PATCH", token: aTok });
  list = (await api(`/api/admin/reservations?status=confirmed`, { token: aTok })).json.reservations;
  item = list.find((x) => x.id === b2.json.reservation.id);
  check("monthly_confirmed=2 (저장 안 해도 전화번호로 합산)", item?.monthly_confirmed === 2, `mc=${item?.monthly_confirmed}`);

  console.log(`\n===== 결과: ${pass} 통과 / ${fail} 실패 =====`);
  await admin.from("reservations").delete().eq("guest_phone", GUEST_PHONE);
  console.log("테스트 데이터 정리 완료.");
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("테스트 오류:", e.message); process.exit(1); });
