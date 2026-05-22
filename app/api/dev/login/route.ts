import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { json, apiError, readJson } from "@/lib/api/http";
import type { UserRole } from "@/lib/supabase/types";

/**
 * POST /api/dev/login   ⚠️ 개발 전용 (ENABLE_DEV_LOGIN=true 일 때만 작동)
 * OTP/문자 없이 테스트 계정(주민/이장님)의 로그인 토큰을 바로 발급합니다.
 * 운영 환경에서는 환경변수를 켜지 않으므로 404를 반환합니다.
 *
 * body: { role?: "resident" | "admin" }
 */
const ENABLED = process.env.ENABLE_DEV_LOGIN === "true";

const ACCOUNTS = {
  resident: {
    email: "dev-resident@example.com",
    password: "dev-1234!",
    name: "김주민",
    phone: "01010001000",
    role: "resident" as UserRole,
    address: "청산면 데모리 1-1" as string | null,
  },
  admin: {
    email: "dev-admin@example.com",
    password: "dev-1234!",
    name: "이장님",
    phone: "01020002000",
    role: "admin" as UserRole,
    address: null as string | null,
  },
};

export async function POST(request: Request) {
  if (!ENABLED) return apiError("개발용 로그인이 비활성화돼 있어요. (.env.local 의 ENABLE_DEV_LOGIN 확인)", 404);

  const body = await readJson<{ role?: "resident" | "admin" }>(request);
  const role: "resident" | "admin" = body?.role === "admin" ? "admin" : "resident";
  const acc = ACCOUNTS[role];
  const admin = createAdminClient();

  // 1) 테스트 계정 보장 (없으면 생성)
  let userId: string | undefined;
  const { data: created } = await admin.auth.admin.createUser({
    email: acc.email,
    password: acc.password,
    email_confirm: true,
  });
  if (created?.user) {
    userId = created.user.id;
  } else {
    for (let p = 1; p <= 10; p++) {
      const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 1000 });
      const u = data.users.find((u) => u.email === acc.email);
      if (u) { userId = u.id; break; }
      if (data.users.length < 1000) break;
    }
  }
  if (!userId) return apiError("테스트 계정 준비에 실패했어요.", 500);

  // 2) 프로필 보장
  await admin.from("profiles").upsert({
    id: userId,
    phone: acc.phone,
    name: acc.name,
    address: acc.address,
    role: acc.role,
  });

  // 3) 로그인 → 토큰 발급
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  );
  const { data: si, error } = await anon.auth.signInWithPassword({
    email: acc.email,
    password: acc.password,
  });
  if (error || !si.session) return apiError("테스트 로그인에 실패했어요: " + (error?.message ?? ""), 500);

  return json({
    access_token: si.session.access_token,
    user: { id: userId, role: acc.role, name: acc.name, phone: acc.phone },
  });
}
