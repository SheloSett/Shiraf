export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      appointments: {
        Row: {
          admin_notes: string | null;
          client_id: string;
          client_notes: string | null;
          created_at: string;
          duration_minutes: number;
          id: string;
          // La agrega la migración 20260813040000: congela el precio del
          // catálogo al momento de reservar. La completa un trigger, por eso en
          // Insert va opcional.
          price: number;
          professional_id: string | null;
          service_id: string;
          starts_at: string;
          status: Database["public"]["Enums"]["appointment_status"];
          updated_at: string;
        };
        Insert: {
          admin_notes?: string | null;
          client_id: string;
          client_notes?: string | null;
          created_at?: string;
          duration_minutes?: number;
          id?: string;
          price?: number;
          professional_id?: string | null;
          service_id: string;
          starts_at: string;
          status?: Database["public"]["Enums"]["appointment_status"];
          updated_at?: string;
        };
        Update: {
          admin_notes?: string | null;
          client_id?: string;
          client_notes?: string | null;
          created_at?: string;
          duration_minutes?: number;
          id?: string;
          price?: number;
          professional_id?: string | null;
          service_id?: string;
          starts_at?: string;
          status?: Database["public"]["Enums"]["appointment_status"];
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "appointments_professional_id_fkey";
            columns: ["professional_id"];
            isOneToOne: false;
            referencedRelation: "professionals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "appointments_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
        ];
      };
      service_categories: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      product_categories: {
        Row: {
          created_at: string;
          id: string;
          name: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          brand: string | null;
          category: string;
          cost: number | null;
          created_at: string;
          id: string;
          min_stock: number;
          name: string;
          stock: number;
          unit: string;
          updated_at: string;
        };
        Insert: {
          brand?: string | null;
          category?: string;
          cost?: number | null;
          created_at?: string;
          id?: string;
          min_stock?: number;
          name: string;
          stock?: number;
          unit?: string;
          updated_at?: string;
        };
        Update: {
          brand?: string | null;
          category?: string;
          cost?: number | null;
          created_at?: string;
          id?: string;
          min_stock?: number;
          name?: string;
          stock?: number;
          unit?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      professional_schedules: {
        Row: {
          created_at: string;
          end_time: string;
          id: string;
          professional_id: string;
          start_time: string;
          weekday: number;
        };
        Insert: {
          created_at?: string;
          end_time: string;
          id?: string;
          professional_id: string;
          start_time: string;
          weekday: number;
        };
        Update: {
          created_at?: string;
          end_time?: string;
          id?: string;
          professional_id?: string;
          start_time?: string;
          weekday?: number;
        };
        Relationships: [
          {
            foreignKeyName: "professional_schedules_professional_id_fkey";
            columns: ["professional_id"];
            isOneToOne: false;
            referencedRelation: "professionals";
            referencedColumns: ["id"];
          },
        ];
      };
      professional_services: {
        Row: {
          id: string;
          professional_id: string;
          service_id: string;
        };
        Insert: {
          id?: string;
          professional_id: string;
          service_id: string;
        };
        Update: {
          id?: string;
          professional_id?: string;
          service_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "professional_services_professional_id_fkey";
            columns: ["professional_id"];
            isOneToOne: false;
            referencedRelation: "professionals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "professional_services_service_id_fkey";
            columns: ["service_id"];
            isOneToOne: false;
            referencedRelation: "services";
            referencedColumns: ["id"];
          },
        ];
      };
      professionals: {
        Row: {
          avatar_url: string | null;
          bio: string | null;
          created_at: string;
          full_name: string;
          id: string;
          is_active: boolean;
          specialty: string | null;
          updated_at: string;
          user_id: string | null;
        };
        Insert: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          full_name: string;
          id?: string;
          is_active?: boolean;
          specialty?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Update: {
          avatar_url?: string | null;
          bio?: string | null;
          created_at?: string;
          full_name?: string;
          id?: string;
          is_active?: boolean;
          specialty?: string | null;
          updated_at?: string;
          user_id?: string | null;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          birth_date: string | null;
          created_at: string;
          full_name: string | null;
          id: string;
          notes: string | null;
          phone: string | null;
          updated_at: string;
        };
        Insert: {
          birth_date?: string | null;
          created_at?: string;
          full_name?: string | null;
          id: string;
          notes?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Update: {
          birth_date?: string | null;
          created_at?: string;
          full_name?: string | null;
          id?: string;
          notes?: string | null;
          phone?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      services: {
        Row: {
          category: string;
          created_at: string;
          description: string | null;
          duration_minutes: number;
          id: string;
          image_url: string | null;
          is_published: boolean;
          name: string;
          price: number;
          updated_at: string;
        };
        Insert: {
          category?: string;
          created_at?: string;
          description?: string | null;
          duration_minutes?: number;
          id?: string;
          image_url?: string | null;
          is_published?: boolean;
          name: string;
          price?: number;
          updated_at?: string;
        };
        Update: {
          category?: string;
          created_at?: string;
          description?: string | null;
          duration_minutes?: number;
          id?: string;
          image_url?: string | null;
          is_published?: boolean;
          name?: string;
          price?: number;
          updated_at?: string;
        };
        Relationships: [];
      };
      stock_movements: {
        Row: {
          created_at: string;
          created_by: string | null;
          id: string;
          product_id: string;
          quantity: number;
          reason: string | null;
        };
        Insert: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          product_id: string;
          quantity: number;
          reason?: string | null;
        };
        Update: {
          created_at?: string;
          created_by?: string | null;
          id?: string;
          product_id?: string;
          quantity?: number;
          reason?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      user_roles: {
        Row: {
          created_at: string;
          id: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          role: Database["public"]["Enums"]["app_role"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          role?: Database["public"]["Enums"]["app_role"];
          user_id?: string;
        };
        Relationships: [];
      };
      // ⚠️ Agregado a mano, no por `supabase gen types`. Las migraciones
      // 20260813060000 y 20260813070000 todavía no se aplicaron al proyecto,
      // así que el generador no las ve, pero la app necesita compilar contra
      // ellas. Regenerar este archivo después de correrlas y borrar esta nota.
      // Migración 20260814010000: notas y costos salen a su propia tabla para
      // que la RLS pueda protegerlos (row-level no puede esconder columnas).
      client_notes: {
        Row: { client_id: string; body: string | null; updated_at: string };
        Insert: { client_id: string; body?: string | null; updated_at?: string };
        Update: { client_id?: string; body?: string | null; updated_at?: string };
        Relationships: [];
      };
      product_costs: {
        Row: { product_id: string; cost: number | null; updated_at: string };
        Insert: { product_id: string; cost?: number | null; updated_at?: string };
        Update: { product_id?: string; cost?: number | null; updated_at?: string };
        Relationships: [];
      };
      user_permissions: {
        Row: {
          created_at: string;
          id: string;
          permission: Database["public"]["Enums"]["app_permission"];
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          permission: Database["public"]["Enums"]["app_permission"];
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          permission?: Database["public"]["Enums"]["app_permission"];
          user_id?: string;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"];
          _user_id: string;
        };
        Returns: boolean;
      };
      has_permission: {
        Args: {
          _permission: Database["public"]["Enums"]["app_permission"];
          _user_id: string;
        };
        Returns: boolean;
      };
      // Migración 20260816000000: renombrado atómico de categorías.
      rename_service_category: {
        Args: { _id: string; _to: string };
        Returns: undefined;
      };
      rename_product_category: {
        Args: { _id: string; _to: string };
        Returns: undefined;
      };
      professional_busy_slots: {
        Args: {
          _from: string;
          _professional_id: string;
          _to: string;
        };
        Returns: {
          slot_minutes: number;
          slot_start: string;
        }[];
      };
    };
    Enums: {
      // 'staff' lo agrega la migración 20260813060000.
      app_role: "admin" | "professional" | "client" | "staff";
      appointment_status: "pending" | "confirmed" | "completed" | "cancelled";
      // app_permission la crea la migración 20260813070000.
      app_permission:
        | "appointments"
        | "clients_contact"
        | "clients_notes"
        | "catalog"
        | "stock"
        | "stock_costs"
        | "team";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "professional", "client", "staff"],
      appointment_status: ["pending", "confirmed", "completed", "cancelled"],
      app_permission: [
        "appointments",
        "clients_contact",
        "clients_notes",
        "catalog",
        "stock",
        "stock_costs",
        "team",
      ],
    },
  },
} as const;
