import { createClient } from "@supabase/supabase-js";
import type { Database } from "./types";

/**
 * service_role 키를 쓰는 관리자용 Supabase 클라이언트.
 *
 * ⚠️ 이 클라이언트는 RLS(행 수준 보안)를 "우회"합니다. 모든 데이터에 접근/수정 가능합니다.
 *   - 절대 브라우저(클라이언트)로 노출하면 안 됩니다. 서버 코드에서만 사용하세요.
 *   - 이장님 확정/취소, 매트릭스 계산용 RPC 호출 등 권한이 필요한 작업에 사용합니다.
 */
export function createAdminClient() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
