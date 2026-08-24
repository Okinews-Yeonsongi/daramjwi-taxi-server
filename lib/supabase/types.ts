// DB 스키마에 대한 TypeScript 타입입니다.
// supabase/migrations 의 스키마(PROJECT_SPEC 5.2)에 맞춰 손으로 작성했습니다.
//
// Supabase 프로젝트를 만든 뒤에는 아래 명령으로 자동 생성/갱신할 수 있습니다:
//   npx supabase gen types typescript --project-id <PROJECT_REF> > lib/supabase/types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// ── 도메인 enum (DDL의 CHECK 제약과 일치) ──────────────────
export type LocationCategory = "cheongsanmyeon" | "eupnae";
export type UserRole = "resident" | "admin";
export type UserStatus = "active" | "suspended";
export type VehicleCode = "A" | "B";
export type ReservationStatus =
  | "waiting"
  | "confirmed"
  | "cancelled"
  | "completed";

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          phone: string;
          name: string;
          role: UserRole;
          status: UserStatus;
          kakao_id: string | null;
          kakao_nickname: string | null;
          kakao_profile_image: string | null;
          vehicle_id: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          phone: string;
          name: string;
          role?: UserRole;
          status?: UserStatus;
          kakao_id?: string | null;
          kakao_nickname?: string | null;
          kakao_profile_image?: string | null;
          vehicle_id?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          phone?: string;
          name?: string;
          role?: UserRole;
          status?: UserStatus;
          kakao_id?: string | null;
          kakao_nickname?: string | null;
          kakao_profile_image?: string | null;
          vehicle_id?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: number;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent: string | null;
          created_at: string;
          last_used_at: string | null;
        };
        Insert: {
          id?: number;
          user_id: string;
          endpoint: string;
          p256dh: string;
          auth: string;
          user_agent?: string | null;
          created_at?: string;
          last_used_at?: string | null;
        };
        Update: {
          id?: number;
          user_id?: string;
          endpoint?: string;
          p256dh?: string;
          auth?: string;
          user_agent?: string | null;
          created_at?: string;
          last_used_at?: string | null;
        };
        Relationships: [];
      };
      vehicles: {
        Row: { id: number; code: VehicleCode; is_active: boolean; plate_number: string | null };
        Insert: { id?: number; code: VehicleCode; is_active?: boolean; plate_number?: string | null };
        Update: { id?: number; code?: VehicleCode; is_active?: boolean; plate_number?: string | null };
        Relationships: [];
      };
      locations: {
        Row: {
          id: number;
          category: LocationCategory;
          name: string;
          emoji: string | null;
          display_order: number;
          is_active: boolean;
        };
        Insert: {
          id?: number;
          category: LocationCategory;
          name: string;
          emoji?: string | null;
          display_order?: number;
          is_active?: boolean;
        };
        Update: {
          id?: number;
          category?: LocationCategory;
          name?: string;
          emoji?: string | null;
          display_order?: number;
          is_active?: boolean;
        };
        Relationships: [];
      };
      time_slots: {
        Row: { hour: number; label: string };
        Insert: { hour: number; label: string };
        Update: { hour?: number; label?: string };
        Relationships: [];
      };
      reservations: {
        Row: {
          id: number;
          user_id: string | null;
          guest_name: string | null;
          guest_phone: string | null;
          reservation_date: string;
          hour: number;
          departure_minute: number;
          persons: number;
          departure_location_id: number;
          arrival_location_id: number;
          vehicle_id: number | null;
          status: ReservationStatus;
          cancelled_at: string | null;
          cancelled_by: string | null;
          cancel_reason: string | null;
          confirmed_at: string | null;
          confirmed_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: number;
          user_id?: string | null;
          guest_name?: string | null;
          guest_phone?: string | null;
          reservation_date: string;
          hour: number;
          departure_minute?: number;
          persons: number;
          departure_location_id: number;
          arrival_location_id: number;
          vehicle_id?: number | null;
          status?: ReservationStatus;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: number;
          user_id?: string | null;
          guest_name?: string | null;
          guest_phone?: string | null;
          reservation_date?: string;
          departure_minute?: number;
          hour?: number;
          persons?: number;
          departure_location_id?: number;
          arrival_location_id?: number;
          vehicle_id?: number | null;
          status?: ReservationStatus;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
          cancel_reason?: string | null;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      v_active_reservations: {
        Row: {
          id: number;
          reservation_date: string;
          hour: number;
          vehicle_id: number | null;
          persons: number;
          departure_category: LocationCategory;
          arrival_category: LocationCategory;
          vehicle_code: VehicleCode | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_admin: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      get_availability: {
        Args: { p_date: string; p_origin: string };
        Returns: { hour: number; remaining: number }[];
      };
      create_reservation_atomic: {
        Args: {
          p_user_id: string;
          p_date: string;
          p_hour: number;
          p_departure_id: number;
          p_arrival_id: number;
          p_persons: number;
        };
        Returns: Database["public"]["Tables"]["reservations"]["Row"];
      };
      create_guest_reservation_atomic: {
        Args: {
          p_guest_name: string;
          p_guest_phone: string;
          p_date: string;
          p_hour: number;
          p_departure_id: number;
          p_arrival_id: number;
          p_persons: number;
          p_user_id?: string | null; // 옵션: 매칭된 회원의 user_id (있으면 회원 예약)
        };
        Returns: Database["public"]["Tables"]["reservations"]["Row"];
      };
      merge_reservations_admin: {
        Args: {
          p_reservation_ids: number[];
          p_new_hour: number;
          p_new_minute: number;
          p_confirmed_by: string;
        };
        Returns: Database["public"]["Tables"]["reservations"]["Row"][];
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
}
