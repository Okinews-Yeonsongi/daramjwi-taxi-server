import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";

/**
 * 일반(anon) 키를 쓰는 서버용 Supabase 클라이언트.
 * 쿠키의 로그인 세션을 그대로 사용하므로 RLS(행 수준 보안)가 적용됩니다.
 * → "지금 로그인한 사용자 본인"의 권한으로 DB에 접근할 때 사용하세요.
 *
 * API Route(route.ts)나 Server Component 안에서 호출합니다.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Component에서 호출되면 쿠키 쓰기가 막힐 수 있습니다.
            // 세션 갱신은 미들웨어가 담당하므로 여기서는 무시해도 됩니다.
          }
        },
      },
    }
  );
}
