import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * 로그인 전 단계(OTP 발송/검증)에서 쓰는 일반 anon 클라이언트.
 * 세션을 저장하지 않는 1회성 서버 클라이언트입니다.
 */
export function createAnonClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
