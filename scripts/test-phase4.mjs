// Phase 4 자동 테스트: 테스트 계정 생성(문자 없이) → 로그인 → 예약 API 검증
// 실행: node --env-file=.env.local scripts/test-phase4.mjs
//   (서버가 http://localhost:3000 에서 떠 있어야 합니다)
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const EMAIL = "phase4-test@example.com";
const PASSWORD = "test-1234!";
const TEST_PHONE = "01099990000";

if (!URL || !ANON || !SERVICE) {
  console.error("환경변수(NEXT_PUBLIC_SUPABASE_URL/ANON_KEY, SERVICE_ROLE_KEY) 누락");
  process.exit(1);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (name, cond, extra = "") => {
  if (cond) { console.log(`  ✅ ${name}`); pass++; }
  else { console.log(`  ❌ ${name}  ${extra}`); fail++; }
};

function kstTomorrow() {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + 24 * 3600 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

async function getOrCreateUser() {
  const { data: created } = await admin.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
  });
  if (created?.user) return created.user.id;
  for (let page = 1; page <= 10; page++) {
    const { data } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    const u = data.users.find((u) => u.email === EMAIL);
    if (u) return u.id;
    if (data.users.length < 1000) break;
  }
  throw new Error("테스트 유저 생성/조회 실패");
}

async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method, headers, body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await res.json(); } catch { /* ignore */ }
  return { status: res.status, json: j };
}

const book = (token, date, hour, dep, arr, persons) =>
  api(`/api/reservations`, { method: "POST", token, body: { date, hour, departure_id: dep, arrival_id: arr, persons } });

async function main() {
  console.log("1) 테스트 계정 준비");
  const userId = await getOrCreateUser();
  await admin.from("profiles").upsert({ id: userId, phone: TEST_PHONE, name: "테스트주민" });
  await admin.from("reservations").delete().eq("user_id", userId); // 이전 테스트 데이터 정리
  const { data: si, error: siErr } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  if (siErr || !si.session) { console.error("로그인 실패:", siErr?.message); process.exit(1); }
  const token = si.session.access_token;
  const date = kstTomorrow();
  console.log(`   userId=${userId}  date=${date}\n`);

  console.log("2) 인증/입력 검증");
  check("토큰 없이 availability → 401", (await api(`/api/availability?date=${date}&origin=cheongsanmyeon`)).status === 401);
  check("persons=5 → 400", (await book(token, date, 10, 1, 4, 5)).status === 400);
  check("같은 카테고리(1→2) → SAME_CATEGORY", (await book(token, date, 10, 1, 2, 1)).json?.code === "SAME_CATEGORY");

  console.log("\n3) 빈 상태 가용성 (10시 4석 기대)");
  const av0 = await api(`/api/availability?date=${date}&origin=cheongsanmyeon`, { token });
  if (av0.status !== 200) {
    console.error("   ❗ availability 실패:", JSON.stringify(av0.json));
    console.error("   → 마이그레이션 0003(SQL 함수)을 아직 안 돌렸을 수 있어요.");
    process.exit(1);
  }
  const slot10 = av0.json.slots.find((s) => s.hour === 10);
  check("10시 remaining=4", slot10?.remaining === 4, JSON.stringify(slot10));

  console.log("\n4) 합승/마감 시나리오 — 10시 청산면(우리집 1)→읍내(병원 4)");
  const r1 = await book(token, date, 10, 1, 4, 2);
  check("#1 (2명) 성공", r1.status === 201, JSON.stringify(r1.json).slice(0, 160));
  const v1 = r1.json?.reservation?.vehicle_id;

  const r2 = await book(token, date, 10, 1, 4, 3);
  check("#2 (3명) 성공", r2.status === 201);
  const v2 = r2.json?.reservation?.vehicle_id;
  check("#2는 빈 차량 배정 → #1과 다른 차량", v1 && v2 && v1 !== v2, `v1=${v1} v2=${v2}`);

  const r3 = await book(token, date, 10, 1, 4, 2);
  check("#3 (2명) 성공 — #1 차량에 합승", r3.status === 201 && r3.json?.reservation?.vehicle_id === v1,
    `v3=${r3.json?.reservation?.vehicle_id} v1=${v1}`);

  const r4 = await book(token, date, 10, 1, 4, 2);
  check("#4 (2명) 마감 → 409 NO_VEHICLE", r4.status === 409 && r4.json?.code === "NO_VEHICLE", JSON.stringify(r4.json));

  const r5 = await book(token, date, 10, 1, 4, 1);
  check("#5 (1명) 성공 — 마지막 1석 합승", r5.status === 201);

  console.log("\n5) 가용성 재확인 — 위치 추적 + 빈복귀 1시간 모델 (0009)");
  const av1 = await api(`/api/availability?date=${date}&origin=cheongsanmyeon`, { token });
  const byHour = Object.fromEntries(av1.json.slots.map((s) => [s.hour, s.remaining]));
  check("10시 마감(remaining=0, 두 차량 모두 그 시간 운행)", byHour[10] === 0, `10=${byHour[10]}`);
  check("9시 마감(remaining=0, 다음 10시 청산 운행이 새 트립의 옥천 도착과 충돌)", byHour[9] === 0, `9=${byHour[9]}`);
  check("11시 마감(remaining=0, 빈복귀 1시간 부족 — 10시 출발 후 12시부터 가능)", byHour[11] === 0, `11=${byHour[11]}`);
  check("12시 가능(remaining=4, 빈복귀 1시간 충족)", byHour[12] === 4, `12=${byHour[12]}`);
  check("13시 가능(remaining=4)", byHour[13] === 4, `13=${byHour[13]}`);

  console.log("\n6) seats 엔드포인트");
  const seat10 = await api(`/api/availability/seats?date=${date}&hour=10&origin=cheongsanmyeon`, { token });
  check("10시 잔여석=0", seat10.json?.remaining === 0, JSON.stringify(seat10.json));
  const seat13 = await api(`/api/availability/seats?date=${date}&hour=13&origin=cheongsanmyeon`, { token });
  check("13시 잔여석=4", seat13.json?.remaining === 4, JSON.stringify(seat13.json));

  console.log(`\n===== 결과: ${pass} 통과 / ${fail} 실패 =====`);
  await admin.from("reservations").delete().eq("user_id", userId); // 정리
  console.log("테스트 예약 정리 완료.");
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error("테스트 오류:", e.message); process.exit(1); });
