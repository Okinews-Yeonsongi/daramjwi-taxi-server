import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";
import { getBearerToken } from "@/lib/api/http";

/**
 * 특정 사용자의 access_token으로 동작하는 Supabase 클라이언트.
 * 그 사용자의 권한(RLS)으로 DB에 접근합니다. (= 본인 데이터만)
 */
export function createUserClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    }
  );
}

/**
 * 요청의 Bearer 토큰을 검증하고, 로그인한 사용자 + 그 사용자용 클라이언트를 반환.
 * 토큰이 없거나 유효하지 않으면 null.
 */
export async function getAuthUser(request: Request) {
  const token = getBearerToken(request);
  if (!token) return null;
  const supabase = createUserClient(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return null;
  return { user: data.user, supabase, token };
}
