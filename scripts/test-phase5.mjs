// Phase 5 자동 테스트: 내 예약 조회 + 취소 (문자 없이 테스트 계정)
// 실행: node --env-file=.env.local scripts/test-phase5.mjs  (서버가 localhost:3000 에 떠 있어야 함)
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const EMAIL = "phase4-test@example.com";
const PASSWORD = "test-1234!";
const TEST_PHONE = "01099990000";

if (!URL || !ANON || !SERVICE) { console.error("환경변수 누락"); process.exit(1); }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name}  ${extra}`); fail++; }
};

const ymd = (offsetDays) => {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 24 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
};

async function getOrCreateUser() {
  const { data: created } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (created?.user) return created.user.id;
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const u = data.users.find((u) => u.email === EMAIL);
    if (u) return u.id;
    if (data.users.length < 1000) break;
  }
  throw new Error("테스트 유저 준비 실패");
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await res.json(); } catch { /* */ }
  return { status: res.status, json: j };
}
const book = (token, date, hour, dep, arr, persons) =>
  api(`/api/reservations`, { method: "POST", token, body: { date, hour, departure_id: dep, arrival_id: arr, persons } });
const cancel = (token, id) => api(`/api/reservations/${id}/cancel`, { method: "PATCH", token });
const myList = (token) => api(`/api/reservations/me`, { token });

async function main() {
  console.log("1) 준비");
  const userId = await getOrCreateUser();
  await admin.from("profiles").upsert({ id: userId, phone: TEST_PHONE, name: "테스트주민" });
  await admin.from("reservations").delete().eq("user_id", userId);
  const { data: si, error: siErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (siErr || !si.session) { console.error("로그인 실패:", siErr?.message); process.exit(1); }
  const token = si.session.access_token;
  const date = ymd(1);
  const vA = (await admin.from("vehicles").select("id").eq("code", "A").single()).data.id;
  console.log(`   userId=${userId} date=${date}\n`);

  console.log("2) 내 예약 목록 (처음 0건)");
  check("토큰 없이 me → 401", (await api("/api/reservations/me")).status === 401);
  check("처음 0건", (await myList(token)).json?.reservations?.length === 0);

  console.log("\n3) 예약 생성 → me에 보이고 정보가 채워짐");
  const r = await book(token, date, 10, 1, 4, 2);
  check("예약 생성 201", r.status === 201, JSON.stringify(r.json).slice(0, 150));
  const rid = r.json.reservation.id;
  const item = (await myList(token)).json.reservations.find((x) => x.id === rid);
  check("me에 보임", !!item);
  check("출발지=청산면사무소", item?.departure?.name === "청산면사무소", JSON.stringify(item?.departure));
  check("도착지=옥천성모병원", item?.arrival?.name === "옥천성모병원");
  check("시간라벨=오전 10시", item?.time_label === "오전 10시", item?.time_label);
  check("차량코드 A/B", item?.vehicle_code === "A" || item?.vehicle_code === "B", item?.vehicle_code);
  check("상태 waiting", item?.status === "waiting");

  console.log("\n4) 본인 취소");
  const c = await cancel(token, rid);
  check("취소 200", c.status === 200, JSON.stringify(c.json));
  check("상태 cancelled", c.json?.reservation?.status === "cancelled");
  check("취소건은 me에서 제외", !(await myList(token)).json.reservations.find((x) => x.id === rid));
  check("이미 취소 재취소 → 400", (await cancel(token, rid)).status === 400);
  check("없는 예약 취소 → 404", (await cancel(token, 999999999)).status === 404);

  console.log("\n5) 카운트 자동 복구 (14시 마감 → 취소 → 복구)");
  const a = await book(token, date, 14, 1, 4, 4);
  const b = await book(token, date, 14, 1, 4, 4);
  check("두 건 생성 성공", a.status === 201 && b.status === 201);
  const rem = async () => (await api(`/api/availability?date=${date}&origin=cheongsanmyeon`, { token })).json.slots.find((s) => s.hour === 14).remaining;
  check("14시 마감(remaining=0)", (await rem()) === 0);
  await cancel(token, b.json.reservation.id);
  check("취소 후 14시 복구(remaining=4)", (await rem()) === 4);

  console.log("\n6) 운행 시작 후 취소 불가 (어제 예약)");
  const past = (await admin.from("reservations").insert({
    user_id: userId, reservation_date: ymd(-1), hour: 9, persons: 1,
    departure_location_id: 1, arrival_location_id: 4, vehicle_id: vA, status: "confirmed",
  }).select().single()).data;
  const cp = await cancel(token, past.id);
  check("지난 운행 취소 → 400", cp.status === 400 && /운행/.test(cp.json?.error || ""), JSON.stringify(cp.json));

  console.log("\n7) 확정 예약 본인 취소 → 200 (기사님 알림 스텁은 서버 로그)");
  const conf = (await admin.from("reservations").insert({
    user_id: userId, reservation_date: date, hour: 16, persons: 2,
    departure_location_id: 1, arrival_location_id: 4, vehicle_id: vA, status: "confirmed",
  }).select().single()).data;
  const cc = await cancel(token, conf.id);
  check("확정 본인취소 200", cc.status === 200, JSON.stringify(cc.json));
  check("상태 cancelled & cancelled_by=본인", cc.json?.reservation?.status === "cancelled" && cc.json?.reservation?.cancelled_by === userId);

  console.log(`\n===== 결과: ${pass} 통과 / ${fail} 실패 =====`);
  await admin.from("reservations").delete().eq("user_id", userId);
  console.log("테스트 예약 정리 완료.");
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("테스트 오류:", e.message); process.exit(1); });
