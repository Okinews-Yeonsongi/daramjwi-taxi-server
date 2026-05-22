// Phase 7 자동 테스트: 이장님(admin) API
// 실행: node --env-file=.env.local scripts/test-phase7.mjs  (서버가 localhost:3000 에 떠 있어야 함)
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BASE = process.env.TEST_BASE_URL || "http://localhost:3000";

const ADMIN_EMAIL = "phase7-admin@example.com", ADMIN_PW = "admin-1234!";
const RES_EMAIL = "phase4-test@example.com", RES_PW = "test-1234!";

if (!URL || !ANON || !SERVICE) { console.error("환경변수 누락"); process.exit(1); }
const admin = createClient(URL, SERVICE, { auth: { persistSession: false } });
const anon = createClient(URL, ANON, { auth: { persistSession: false } });

let pass = 0, fail = 0;
const check = (n, c, e = "") => { if (c) { console.log(`  ✅ ${n}`); pass++; } else { console.log(`  ❌ ${n}  ${e}`); fail++; } };
const ymd = (off) => { const d = new Date(Date.now() + 9 * 3600 * 1000 + off * 24 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`; };

async function ensureUser(email, pw) {
  const { data: c } = await admin.auth.admin.createUser({ email, password: pw, email_confirm: true });
  if (c?.user) return c.user.id;
  for (let p = 1; p <= 10; p++) {
    const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 1000 });
    const u = data.users.find((u) => u.email === email);
    if (u) return u.id;
    if (data.users.length < 1000) break;
  }
  throw new Error("유저 준비 실패: " + email);
}
async function token(email, pw) {
  const { data, error } = await anon.auth.signInWithPassword({ email, password: pw });
  if (error) throw new Error("로그인 실패: " + error.message);
  return data.session.access_token;
}
async function api(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await res.json(); } catch { /* */ }
  return { status: res.status, json: j };
}

async function main() {
  console.log("0) 준비 (admin + resident)");
  const adminId = await ensureUser(ADMIN_EMAIL, ADMIN_PW);
  const resId = await ensureUser(RES_EMAIL, RES_PW);
  await admin.from("profiles").upsert({ id: adminId, phone: "01088887777", name: "이장님", role: "admin" });
  await admin.from("profiles").upsert({ id: resId, phone: "01099990000", name: "테스트주민", address: "청산면", role: "resident" });
  await admin.from("reservations").delete().eq("user_id", resId);
  const aTok = await token(ADMIN_EMAIL, ADMIN_PW);
  const rTok = await token(RES_EMAIL, RES_PW);
  const vA = (await admin.from("vehicles").select("id").eq("code", "A").single()).data.id;
  const date = ymd(1);

  console.log("\n1) 권한 가드");
  check("토큰 없이 dashboard → 401", (await api("/api/admin/dashboard")).status === 401);
  check("주민 토큰 dashboard → 403", (await api("/api/admin/dashboard", { token: rTok })).status === 403);
  check("관리자 dashboard → 200", (await api("/api/admin/dashboard", { token: aTok })).status === 200);

  console.log("\n2) 예약 생성(주민) → 관리자 조회");
  const r = await api("/api/reservations", { method: "POST", token: rTok, body: { date, hour: 10, departure_id: 1, arrival_id: 4, persons: 2 } });
  check("주민 예약 생성 201", r.status === 201, JSON.stringify(r.json).slice(0, 150));
  const rid = r.json.reservation.id;
  const list = await api(`/api/admin/reservations?status=waiting`, { token: aTok });
  const found = list.json.reservations.find((x) => x.id === rid);
  check("waiting 목록에 있음", !!found);
  check("주민 이름·전화 포함(관리자)", found?.resident?.name === "테스트주민" && found?.resident?.phone === "01099990000", JSON.stringify(found?.resident));

  console.log("\n3) 확정");
  const conf = await api(`/api/admin/reservations/${rid}/confirm`, { method: "PATCH", token: aTok });
  check("확정 200 + status confirmed", conf.status === 200 && conf.json?.reservation?.status === "confirmed", JSON.stringify(conf.json).slice(0, 150));
  check("confirmed_by=이장님", conf.json?.reservation?.confirmed_by === adminId);
  check("이미 확정 재확정 → 400", (await api(`/api/admin/reservations/${rid}/confirm`, { method: "PATCH", token: aTok })).status === 400);

  console.log("\n4) 취소(사유 필수)");
  check("사유 없이 취소 → 400", (await api(`/api/admin/reservations/${rid}/cancel`, { method: "PATCH", token: aTok, body: {} })).status === 400);
  const can = await api(`/api/admin/reservations/${rid}/cancel`, { method: "PATCH", token: aTok, body: { reason: "차량 점검" } });
  check("취소 200 + status cancelled + 사유 저장", can.status === 200 && can.json?.reservation?.status === "cancelled" && can.json?.reservation?.cancel_reason === "차량 점검", JSON.stringify(can.json).slice(0, 150));

  console.log("\n5) 확정 한도(일 4회) 검사");
  const limDate = ymd(3);
  await admin.from("reservations").delete().eq("user_id", resId).eq("reservation_date", limDate);
  // 이미 확정 4건 채워둠
  await admin.from("reservations").insert([9, 10, 11, 12].map((h) => ({
    user_id: resId, reservation_date: limDate, hour: h, persons: 1, departure_location_id: 1, arrival_location_id: 4, vehicle_id: vA, status: "confirmed",
  })));
  // 같은 날 대기 1건 추가 → 확정 시도하면 한도 초과
  const extra = (await admin.from("reservations").insert({ user_id: resId, reservation_date: limDate, hour: 13, persons: 1, departure_location_id: 1, arrival_location_id: 4, vehicle_id: vA, status: "waiting" }).select().single()).data;
  const over = await api(`/api/admin/reservations/${extra.id}/confirm`, { method: "PATCH", token: aTok });
  check("한도 초과 확정 → 409 DAILY_LIMIT", over.status === 409 && over.json?.code === "DAILY_LIMIT", JSON.stringify(over.json));

  console.log("\n6) 주민 목록 + 확정 횟수");
  const profs = await api("/api/admin/profiles", { token: aTok });
  const me = profs.json.profiles.find((p) => p.id === resId);
  check("주민 목록에 테스트주민 + confirmed_count 숫자", !!me && typeof me.confirmed_count === "number", JSON.stringify(me)?.slice(0, 120));
  check("confirmed_count ≥ 4 (방금 4건 확정)", me?.confirmed_count >= 4, `count=${me?.confirmed_count}`);

  console.log("\n7) 대시보드 / 통계 구조");
  const dash = await api("/api/admin/dashboard", { token: aTok });
  check("대시보드 구조", dash.json?.today && dash.json?.limits?.daily && dash.json?.fare === 1700, JSON.stringify(dash.json)?.slice(0, 150));
  const stats = await api(`/api/admin/stats?month=${date.slice(0, 7)}`, { token: aTok });
  check("통계 구조(totals/by_day)", stats.json?.totals && Array.isArray(stats.json?.by_day), JSON.stringify(stats.json)?.slice(0, 150));
  check("잘못된 month → 400", (await api("/api/admin/stats?month=2026-13-99", { token: aTok })).status === 400);

  console.log(`\n===== 결과: ${pass} 통과 / ${fail} 실패 =====`);
  await admin.from("reservations").delete().eq("user_id", resId);
  console.log("테스트 데이터 정리 완료.");
  process.exit(fail > 0 ? 1 : 0);
}
main().catch((e) => { console.error("테스트 오류:", e.message); process.exit(1); });
