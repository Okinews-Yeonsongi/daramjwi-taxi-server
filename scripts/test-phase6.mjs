// Phase 6 자동 테스트: 오늘 운행 + 마을 현황
// 실행: node --env-file=.env.local scripts/test-phase6.mjs  (서버가 localhost:3000 에 떠 있어야 함)
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";
const EMAIL = "phase4-test@example.com";
const PASSWORD = "test-1234!";

if (!URL || !ANON || !SERVICE) { console.error("환경변수 누락"); process.exit(1); }
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { console.log(`  ✅ ${n}`); pass++; } else { console.log(`  ❌ ${n}  ${e}`); fail++; } };
const todayStr = () => { const d = new Date(Date.now() + 9 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; };

async function getOrCreateUser() {
  const { data: c } = await admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true });
  if (c?.user) return c.user.id;
  for (let p = 1; p <= 10; p++) {
    const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 1000 });
    const u = data.users.find((u) => u.email === EMAIL);
    if (u) return u.id;
    if (data.users.length < 1000) break;
  }
  throw new Error("유저 준비 실패");
}
async function api(path, token) {
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  let j = null; try { j = await res.json(); } catch { /* */ }
  return { status: res.status, json: j };
}

async function main() {
  const userId = await getOrCreateUser();
  await admin.from("profiles").upsert({ id: userId, phone: "01099990000", name: "테스트주민" });
  const { data: si } = await anon.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
  const token = si.session.access_token;
  const vA = (await admin.from("vehicles").select("id").eq("code", "A").single()).data.id;
  const vB = (await admin.from("vehicles").select("id").eq("code", "B").single()).data.id;
  const today = todayStr();
  const ins = (rows) => admin.from("reservations").insert(rows);

  console.log("A) 오늘 운행 /api/runs/today");
  await admin.from("reservations").delete().eq("user_id", userId);
  await ins([
    { user_id: userId, reservation_date: today, hour: 10, persons: 2, departure_location_id: 1, arrival_location_id: 4, vehicle_id: vA, status: "confirmed" },
    { user_id: userId, reservation_date: today, hour: 10, persons: 1, departure_location_id: 1, arrival_location_id: 4, vehicle_id: vA, status: "waiting" },   // 위와 같은 운행(합산)
    { user_id: userId, reservation_date: today, hour: 10, persons: 2, departure_location_id: 1, arrival_location_id: 5, vehicle_id: vB, status: "confirmed" }, // 다른 차량 → 별도 운행
    { user_id: userId, reservation_date: today, hour: 14, persons: 1, departure_location_id: 4, arrival_location_id: 1, vehicle_id: vA, status: "confirmed" },
    { user_id: userId, reservation_date: today, hour: 11, persons: 1, departure_location_id: 1, arrival_location_id: 4, vehicle_id: vA, status: "cancelled" },  // 제외
  ]);
  check("토큰 없이 → 401", (await api(`/api/runs/today`)).status === 401);
  const runs = (await api(`/api/runs/today`, token)).json?.runs ?? [];
  const h10 = runs.filter((r) => r.hour === 10 && r.origin === "cheongsanmyeon");
  check("10시 청산면 운행 2건(차량별)", h10.length === 2, JSON.stringify(h10));
  check("10시 합산 인원 [3,2] 존재", [3, 2].every((p) => h10.some((r) => r.persons === p)), JSON.stringify(h10.map((r) => r.persons)));
  const h10a = h10.find((r) => r.persons === 3);
  check("seats_left 계산(3명→1석)", h10a?.seats_left === 1, JSON.stringify(h10a));
  check("방향 destination=eupnae", h10a?.destination === "eupnae");
  check("14시 운행 1건(인원1)", runs.some((r) => r.hour === 14 && r.persons === 1));
  check("취소건 제외(11시 없음)", !runs.some((r) => r.hour === 11));
  check("차량 식별 비공개(vehicle 필드 없음)", h10a && !("vehicle_code" in h10a) && !("vehicle_id" in h10a));

  console.log("\nB) 마을 현황 /api/stats/village (델타 검증)");
  await admin.from("reservations").delete().eq("user_id", userId);
  const base = (await api(`/api/stats/village`, token)).json;
  check("기본 응답 구조 + 요금 1700", base?.fare === 1700 && base?.daily?.limit === 4 && base?.monthly?.limit === 112, JSON.stringify(base));

  const dd = Number(today.split("-")[2]);
  const [yy, mm] = today.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const monthDays = [1, 2, 3, 4, 5].filter((d) => d !== dd).slice(0, 3);
  const lm = mm === 1 ? 12 : mm - 1, ly = mm === 1 ? yy - 1 : yy;
  await ins([
    // 오늘 확정 2건 (daily+monthly)
    { user_id: userId, reservation_date: today, hour: 9, persons: 1, departure_location_id: 1, arrival_location_id: 4, vehicle_id: vA, status: "confirmed" },
    { user_id: userId, reservation_date: today, hour: 12, persons: 1, departure_location_id: 1, arrival_location_id: 4, vehicle_id: vB, status: "confirmed" },
    // 이번달(오늘 아님) 확정 3건 (monthly만)
    ...monthDays.map((d, i) => ({ user_id: userId, reservation_date: `${yy}-${pad(mm)}-${pad(d)}`, hour: 9 + i, persons: 1, departure_location_id: 1, arrival_location_id: 4, vehicle_id: vA, status: "confirmed" })),
    // 지난달 확정 1건 (제외)
    { user_id: userId, reservation_date: `${ly}-${pad(lm)}-15`, hour: 9, persons: 1, departure_location_id: 1, arrival_location_id: 4, vehicle_id: vA, status: "confirmed" },
    // 오늘 취소/대기 (제외)
    { user_id: userId, reservation_date: today, hour: 15, persons: 1, departure_location_id: 1, arrival_location_id: 4, vehicle_id: vA, status: "cancelled" },
    { user_id: userId, reservation_date: today, hour: 16, persons: 1, departure_location_id: 1, arrival_location_id: 4, vehicle_id: vA, status: "waiting" },
  ]);
  const after = (await api(`/api/stats/village`, token)).json;
  check("오늘 확정 +2 (daily.used 증가)", after.daily.used - base.daily.used === 2, `base=${base.daily.used} after=${after.daily.used}`);
  check("이번달 확정 +5 (monthly.used 증가)", after.monthly.used - base.monthly.used === 5, `base=${base.monthly.used} after=${after.monthly.used}`);
  check("daily.remaining = 4 - used", after.daily.remaining === Math.max(0, 4 - after.daily.used));
  check("monthly.remaining = 112 - used", after.monthly.remaining === Math.max(0, 112 - after.monthly.used));

  console.log(`\n===== 결과: ${pass} 통과 / ${fail} 실패 =====`);
  await admin.from("reservations").delete().eq("user_id", userId);
  console.log("테스트 데이터 정리 완료.");
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("테스트 오류:", e.message); process.exit(1); });
