import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exchangeCodeForToken,
  fetchKakaoUserInfo,
  derivePasswordFromKakaoId,
  syntheticEmail,
} from "@/lib/api/kakao";

/**
 * GET /api/auth/kakao/callback?code=...&state=...
 * 카카오에서 돌아온 code로 사용자 식별 → Supabase 세션 발급 →
 * 프론트로 #access_token=... 형태로 리다이렉트.
 *
 * 흐름:
 *  1) code → kakao access_token
 *  2) kakao access_token → kakao 사용자 정보 (id, 닉네임, 프사)
 *  3) Supabase admin API로 사용자 보장 (kakao_id 매칭 → 없으면 생성)
 *  4) signInWithPassword 로 토큰 발급 (사용자 보이지 않는 합성 이메일/비밀번호)
 *  5) 프론트로 #access_token=...&refresh_token=...&needsOnboarding=... fragment 리다이렉트
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");

  if (!code) {
    return htmlError("카카오에서 code를 받지 못했어요. 다시 시도해 주세요.");
  }

  let nextPath = "/";
  try {
    if (stateRaw) {
      const parsed = JSON.parse(Buffer.from(stateRaw, "base64url").toString("utf-8"));
      if (typeof parsed.next === "string") nextPath = parsed.next;
    }
  } catch {
    // state 파싱 실패해도 로그인은 진행
  }

  try {
    // 1+2) 카카오 사용자 정보
    const kakaoAccessToken = await exchangeCodeForToken(code);
    const kakaoUser = await fetchKakaoUserInfo(kakaoAccessToken);
    const kakaoId = String(kakaoUser.id);
    const nickname = kakaoUser.kakao_account?.profile?.nickname ?? "이용자";
    const profileImage = kakaoUser.kakao_account?.profile?.profile_image_url ?? null;

    // 3) Supabase 사용자 확정 (있으면 갱신, 없으면 생성)
    const admin = createAdminClient();
    const email = syntheticEmail(kakaoId);
    const password = derivePasswordFromKakaoId(kakaoId);

    // 기존 프로필 검색 (kakao_id로)
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id, phone, name, role")
      .eq("kakao_id", kakaoId)
      .maybeSingle();

    let userId: string;
    let needsOnboarding = false;

    if (existingProfile) {
      userId = existingProfile.id;
      // 카카오 닉네임·프사 최신화 (이름은 사용자가 바꿨을 수 있으니 두지 않음)
      await admin
        .from("profiles")
        .update({
          kakao_nickname: nickname,
          kakao_profile_image: profileImage,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId);
      // 전화번호 비어있으면 온보딩 필요
      needsOnboarding = !existingProfile.phone;
    } else {
      // 새 사용자: Supabase Auth 사용자 생성 (있으면 그대로 사용)
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createErr && !createErr.message?.includes("already")) {
        throw new Error(`Auth 사용자 생성 실패: ${createErr.message}`);
      }
      if (created?.user) {
        userId = created.user.id;
      } else {
        // 이미 있는 경우 — listUsers로 찾기
        let found: string | undefined;
        for (let p = 1; p <= 10; p++) {
          const { data } = await admin.auth.admin.listUsers({ page: p, perPage: 1000 });
          const u = data.users.find((u) => u.email === email);
          if (u) {
            found = u.id;
            break;
          }
          if (data.users.length < 1000) break;
        }
        if (!found) throw new Error("기존 Auth 사용자 조회 실패");
        userId = found;
      }
      // profiles upsert (전화번호 빈 상태로)
      await admin.from("profiles").upsert({
        id: userId,
        phone: "",
        name: nickname,
        role: "resident",
        kakao_id: kakaoId,
        kakao_nickname: nickname,
        kakao_profile_image: profileImage,
      });
      needsOnboarding = true;
    }

    // 4) 로그인 → 세션 토큰
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    );
    const { data: si, error: siErr } = await anon.auth.signInWithPassword({
      email,
      password,
    });
    if (siErr || !si.session) {
      throw new Error(`로그인 토큰 발급 실패: ${siErr?.message ?? "session 없음"}`);
    }

    // 5) 프론트로 토큰 전달 (fragment: 서버 로그/Referer에 안 남음)
    const safeNext = nextPath.startsWith("/") ? nextPath : "/";
    const fragment = new URLSearchParams({
      access_token: si.session.access_token,
      refresh_token: si.session.refresh_token,
      needsOnboarding: needsOnboarding ? "1" : "0",
    }).toString();

    const target = `${safeNext}#${fragment}`;

    // HTML 리다이렉트 (fragment 보존)
    return new Response(
      `<!doctype html><meta charset="utf-8"><title>로그인 처리중…</title>
<script>location.replace(${JSON.stringify(target)});</script>
<p>로그인 처리중… 자동으로 이동하지 않으면 <a href="${target}">여기</a> 클릭.</p>`,
      { headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  } catch (e) {
    const msg = (e as Error).message ?? "알 수 없는 오류";
    console.error("[kakao callback] 실패:", msg);
    return htmlError(`로그인 실패: ${msg}`);
  }
}

function htmlError(message: string): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>로그인 실패</title>
<h1>로그인 실패 🐿️</h1>
<p>${escapeHtml(message)}</p>
<p><a href="/dev-console.html">콘솔로 돌아가기</a></p>`,
    { status: 400, headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c));
}
