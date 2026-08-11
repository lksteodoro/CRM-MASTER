// Tipos do banco.
//
// Escritos no mesmo formato que `supabase gen types typescript` produz — o
// supabase-js depende dessa forma exata para inferir Row/Insert/Update nas
// queries. Depois que o projeto Supabase existir, regenere com:
//
//   npx supabase gen types typescript --project-id <SEU_PROJECT_ID> \
//     > src/integrations/supabase/database.types.ts
//
// e substitua este arquivo.

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type UserRole = 'ADMIN' | 'CLIENT';
export type UserStatus = 'ACTIVE' | 'INVITED' | 'DISABLED';
export type ClientStatus = 'ACTIVE' | 'INACTIVE' | 'ARCHIVED';
export type ProjectStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type AuditAction = 'INSERT' | 'UPDATE' | 'DELETE' | 'LOGIN' | 'INVITE';
export type LeadIdentityStrategy = 'EMAIL' | 'PHONE' | 'EMAIL_OR_PHONE' | 'EXTERNAL_ID';
export type AttributionStrategy = 'FIRST_TOUCH' | 'LAST_TOUCH';
export type MetaIntegrationStatus = 'DISCONNECTED' | 'CONNECTED' | 'ERROR';

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          slug: string;
          status: 'active' | 'inactive';
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          slug: string;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          slug?: string;
          status?: 'active' | 'inactive';
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          organization_id: string | null;
          name: string;
          email: string;
          role: UserRole;
          status: UserStatus;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          organization_id?: string | null;
          name?: string;
          email: string;
          role?: UserRole;
          status?: UserStatus;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string | null;
          name?: string;
          email?: string;
          role?: UserRole;
          status?: UserStatus;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      clients: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          legal_name: string | null;
          document: string | null;
          logo_url: string | null;
          status: ClientStatus;
          telao_token: string | null;
          telao_active: boolean;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          legal_name?: string | null;
          document?: string | null;
          logo_url?: string | null;
          status?: ClientStatus;
          telao_token?: string | null;
          telao_active?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          legal_name?: string | null;
          document?: string | null;
          logo_url?: string | null;
          status?: ClientStatus;
          telao_token?: string | null;
          telao_active?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      client_users: {
        Row: {
          id: string;
          client_id: string;
          user_id: string;
          status: 'ACTIVE' | 'DISABLED';
          created_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          user_id: string;
          status?: 'ACTIVE' | 'DISABLED';
          created_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          user_id?: string;
          status?: 'ACTIVE' | 'DISABLED';
          created_at?: string;
        };
        Relationships: [];
      };
      projects: {
        Row: {
          id: string;
          organization_id: string;
          client_id: string;
          name: string;
          slug: string;
          description: string | null;
          status: ProjectStatus;
          timezone: string;
          currency: string;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          client_id: string;
          name: string;
          slug: string;
          description?: string | null;
          status?: ProjectStatus;
          timezone?: string;
          currency?: string;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          client_id?: string;
          name?: string;
          slug?: string;
          description?: string | null;
          status?: ProjectStatus;
          timezone?: string;
          currency?: string;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      project_users: {
        Row: {
          id: string;
          project_id: string;
          user_id: string;
          can_view: boolean;
          can_edit_goals: boolean;
          can_edit_settings: boolean;
          can_view_leads: boolean;
          can_view_sales: boolean;
          can_view_commercial: boolean;
          can_export: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          user_id: string;
          can_view?: boolean;
          can_edit_goals?: boolean;
          can_edit_settings?: boolean;
          can_view_leads?: boolean;
          can_view_sales?: boolean;
          can_view_commercial?: boolean;
          can_export?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          user_id?: string;
          can_view?: boolean;
          can_edit_goals?: boolean;
          can_edit_settings?: boolean;
          can_view_leads?: boolean;
          can_view_sales?: boolean;
          can_view_commercial?: boolean;
          can_export?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      project_goals: {
        Row: {
          id: string;
          project_id: string;
          period_start: string;
          period_end: string;
          spend_goal: number | null;
          lead_goal: number | null;
          cpl_goal: number | null;
          sales_goal: number | null;
          cac_goal: number | null;
          revenue_goal: number | null;
          roas_goal: number | null;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          project_id: string;
          period_start: string;
          period_end: string;
          spend_goal?: number | null;
          lead_goal?: number | null;
          cpl_goal?: number | null;
          sales_goal?: number | null;
          cac_goal?: number | null;
          revenue_goal?: number | null;
          roas_goal?: number | null;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string;
          period_start?: string;
          period_end?: string;
          spend_goal?: number | null;
          lead_goal?: number | null;
          cpl_goal?: number | null;
          sales_goal?: number | null;
          cac_goal?: number | null;
          revenue_goal?: number | null;
          roas_goal?: number | null;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      project_settings: {
        Row: {
          id: string;
          project_id: string;
          lead_identity_strategy: LeadIdentityStrategy;
          attribution_strategy: AttributionStrategy;
          alerts_enabled: boolean;
          commercial_enabled: boolean;
          ranking_enabled: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          lead_identity_strategy?: LeadIdentityStrategy;
          attribution_strategy?: AttributionStrategy;
          alerts_enabled?: boolean;
          commercial_enabled?: boolean;
          ranking_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          lead_identity_strategy?: LeadIdentityStrategy;
          attribution_strategy?: AttributionStrategy;
          alerts_enabled?: boolean;
          commercial_enabled?: boolean;
          ranking_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      audit_logs: {
        Row: {
          id: string;
          organization_id: string | null;
          user_id: string | null;
          entity_type: string;
          entity_id: string | null;
          action: AuditAction;
          field_name: string | null;
          old_value: Json | null;
          new_value: Json | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id?: string | null;
          user_id?: string | null;
          entity_type: string;
          entity_id?: string | null;
          action: AuditAction;
          field_name?: string | null;
          old_value?: Json | null;
          new_value?: Json | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string | null;
          user_id?: string | null;
          entity_type?: string;
          entity_id?: string | null;
          action?: AuditAction;
          field_name?: string | null;
          old_value?: Json | null;
          new_value?: Json | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      meta_integrations: {
        Row: {
          id: string;
          project_id: string;
          ad_account_id: string;
          access_token: string;
          account_name: string | null;
          status: MetaIntegrationStatus;
          selected_campaign_ids: string[];
          last_synced_at: string | null;
          last_error: string | null;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          project_id: string;
          ad_account_id: string;
          access_token: string;
          account_name?: string | null;
          status?: MetaIntegrationStatus;
          selected_campaign_ids?: string[];
          last_synced_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string;
          ad_account_id?: string;
          access_token?: string;
          account_name?: string | null;
          status?: MetaIntegrationStatus;
          selected_campaign_ids?: string[];
          last_synced_at?: string | null;
          last_error?: string | null;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      contacts: {
        Row: {
          id: string;
          client_id: string;
          name: string | null;
          normalized_phone: string | null;
          normalized_email: string | null;
          original_phone: string | null;
          original_email: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          name?: string | null;
          normalized_phone?: string | null;
          normalized_email?: string | null;
          original_phone?: string | null;
          original_email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          name?: string | null;
          normalized_phone?: string | null;
          normalized_email?: string | null;
          original_phone?: string | null;
          original_email?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      lead_events: {
        Row: {
          id: string;
          contact_id: string;
          project_id: string;
          external_id: string | null;
          occurred_at: string;
          campaign_id: string | null;
          adset_id: string | null;
          ad_id: string | null;
          utm_source: string | null;
          utm_medium: string | null;
          utm_campaign: string | null;
          utm_content: string | null;
          utm_term: string | null;
          source: string;
          status: string;
          attribution_status: string;
          raw_payload: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          project_id: string;
          external_id?: string | null;
          occurred_at?: string;
          campaign_id?: string | null;
          adset_id?: string | null;
          ad_id?: string | null;
          utm_source?: string | null;
          utm_medium?: string | null;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_term?: string | null;
          source?: string;
          status?: string;
          attribution_status?: string;
          raw_payload?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          contact_id?: string;
          project_id?: string;
          external_id?: string | null;
          occurred_at?: string;
          campaign_id?: string | null;
          adset_id?: string | null;
          ad_id?: string | null;
          utm_source?: string | null;
          utm_medium?: string | null;
          utm_campaign?: string | null;
          utm_content?: string | null;
          utm_term?: string | null;
          source?: string;
          status?: string;
          attribution_status?: string;
          raw_payload?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sales: {
        Row: {
          id: string;
          contact_id: string;
          project_id: string;
          lead_event_id: string | null;
          seller_id: string | null;
          external_sale_id: string | null;
          amount: number | null;
          status: string;
          payment_method: string | null;
          sold_at: string;
          raw_payload: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          contact_id: string;
          project_id: string;
          lead_event_id?: string | null;
          seller_id?: string | null;
          external_sale_id?: string | null;
          amount?: number | null;
          status?: string;
          payment_method?: string | null;
          sold_at?: string;
          raw_payload?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          contact_id?: string;
          project_id?: string;
          lead_event_id?: string | null;
          seller_id?: string | null;
          external_sale_id?: string | null;
          amount?: number | null;
          status?: string;
          payment_method?: string | null;
          sold_at?: string;
          raw_payload?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      sellers: {
        Row: {
          id: string;
          client_id: string;
          name: string;
          active: boolean;
          photo_url: string | null;
          sales_goal: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          name: string;
          active?: boolean;
          photo_url?: string | null;
          sales_goal?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          name?: string;
          active?: boolean;
          photo_url?: string | null;
          sales_goal?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      client_ranking_settings: {
        Row: {
          id: string;
          client_id: string;
          prize_first: string | null;
          prize_second: string | null;
          prize_third: string | null;
          bonus_label: string | null;
          sound_enabled: boolean;
          sound_choice: string;
          animation_enabled: boolean;
          sale_banner_message: string;
          panel_title: string;
          panel_subtitle: string;
          panel_live_badge: string;
          panel_season_label: string | null;
          panel_brand_subtitle: string;
          panel_celebration_label: string;
          panel_footer_text: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          client_id: string;
          prize_first?: string | null;
          prize_second?: string | null;
          prize_third?: string | null;
          bonus_label?: string | null;
          sound_enabled?: boolean;
          sound_choice?: string;
          animation_enabled?: boolean;
          sale_banner_message?: string;
          panel_title?: string;
          panel_subtitle?: string;
          panel_live_badge?: string;
          panel_season_label?: string | null;
          panel_brand_subtitle?: string;
          panel_celebration_label?: string;
          panel_footer_text?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          client_id?: string;
          prize_first?: string | null;
          prize_second?: string | null;
          prize_third?: string | null;
          bonus_label?: string | null;
          sound_enabled?: boolean;
          sound_choice?: string;
          animation_enabled?: boolean;
          sale_banner_message?: string;
          panel_title?: string;
          panel_subtitle?: string;
          panel_live_badge?: string;
          panel_season_label?: string | null;
          panel_brand_subtitle?: string;
          panel_celebration_label?: string;
          panel_footer_text?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      seller_point_adjustments: {
        Row: {
          id: string;
          seller_id: string;
          amount: number;
          note: string | null;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          seller_id: string;
          amount: number;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          seller_id?: string;
          amount?: number;
          note?: string | null;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      webhook_inbox: {
        Row: {
          id: string;
          client_id: string | null;
          project_id: string | null;
          event_type: string;
          source: string;
          external_event_id: string | null;
          payload_hash: string | null;
          payload_raw: Json;
          received_at: string;
          processing_started_at: string | null;
          processed_at: string | null;
          processing_status: string;
          retry_count: number;
          last_error: string | null;
          normalized_event_id: string | null;
        };
        Insert: {
          id?: string;
          client_id?: string | null;
          project_id?: string | null;
          event_type: string;
          source?: string;
          external_event_id?: string | null;
          payload_hash?: string | null;
          payload_raw: Json;
          received_at?: string;
          processing_started_at?: string | null;
          processed_at?: string | null;
          processing_status?: string;
          retry_count?: number;
          last_error?: string | null;
          normalized_event_id?: string | null;
        };
        Update: {
          id?: string;
          client_id?: string | null;
          project_id?: string | null;
          event_type?: string;
          source?: string;
          external_event_id?: string | null;
          payload_hash?: string | null;
          payload_raw?: Json;
          received_at?: string;
          processing_started_at?: string | null;
          processed_at?: string | null;
          processing_status?: string;
          retry_count?: number;
          last_error?: string | null;
          normalized_event_id?: string | null;
        };
        Relationships: [];
      };
      project_integrations: {
        Row: {
          id: string;
          project_id: string;
          integration_type: string;
          external_code: string;
          secret: string;
          active: boolean;
          created_at: string;
          updated_at: string;
          created_by: string | null;
        };
        Insert: {
          id?: string;
          project_id: string;
          integration_type?: string;
          external_code: string;
          secret: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Update: {
          id?: string;
          project_id?: string;
          integration_type?: string;
          external_code?: string;
          secret?: string;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
          created_by?: string | null;
        };
        Relationships: [];
      };
      meta_entities: {
        Row: {
          id: string;
          project_id: string;
          entity_type: string;
          external_id: string;
          name: string;
          status: string | null;
          parent_external_id: string | null;
          thumbnail_url: string | null;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          entity_type: string;
          external_id: string;
          name: string;
          status?: string | null;
          parent_external_id?: string | null;
          thumbnail_url?: string | null;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          entity_type?: string;
          external_id?: string;
          name?: string;
          status?: string | null;
          parent_external_id?: string | null;
          thumbnail_url?: string | null;
          updated_at?: string;
        };
        Relationships: [];
      };
      meta_ad_insights_daily: {
        Row: {
          id: string;
          project_id: string;
          date: string;
          campaign_id: string;
          campaign_name: string;
          campaign_status: string | null;
          adset_id: string | null;
          adset_name: string | null;
          ad_id: string;
          ad_name: string;
          spend: number;
          impressions: number;
          clicks: number;
          link_clicks: number;
          reach: number;
          leads: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          date: string;
          campaign_id: string;
          campaign_name: string;
          campaign_status?: string | null;
          adset_id?: string | null;
          adset_name?: string | null;
          ad_id: string;
          ad_name: string;
          spend?: number;
          impressions?: number;
          clicks?: number;
          link_clicks?: number;
          reach?: number;
          leads?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          date?: string;
          campaign_id?: string;
          campaign_name?: string;
          campaign_status?: string | null;
          adset_id?: string | null;
          adset_name?: string | null;
          ad_id?: string;
          ad_name?: string;
          spend?: number;
          impressions?: number;
          clicks?: number;
          link_clicks?: number;
          reach?: number;
          leads?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      meta_insights_daily: {
        Row: {
          id: string;
          project_id: string;
          date: string;
          spend: number;
          impressions: number;
          clicks: number;
          link_clicks: number;
          reach: number;
          leads: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          project_id: string;
          date: string;
          spend?: number;
          impressions?: number;
          clicks?: number;
          link_clicks?: number;
          reach?: number;
          leads?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          project_id?: string;
          date?: string;
          spend?: number;
          impressions?: number;
          clicks?: number;
          link_clicks?: number;
          reach?: number;
          leads?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      agency_tasks: {
        Row: {
          id: string;
          organization_id: string;
          created_by: string;
          title: string;
          description: string | null;
          category: 'marketing' | 'disparo_massa' | 'outro';
          status: 'backlog' | 'a_fazer' | 'fazendo' | 'finalizado';
          position: number;
          estimated_minutes: number | null;
          due_date: string | null;
          finished_at: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id?: string;
          created_by?: string;
          title: string;
          description?: string | null;
          category?: 'marketing' | 'disparo_massa' | 'outro';
          status?: 'backlog' | 'a_fazer' | 'fazendo' | 'finalizado';
          position?: number;
          estimated_minutes?: number | null;
          due_date?: string | null;
          finished_at?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          created_by?: string;
          title?: string;
          description?: string | null;
          category?: 'marketing' | 'disparo_massa' | 'outro';
          status?: 'backlog' | 'a_fazer' | 'fazendo' | 'finalizado';
          position?: number;
          estimated_minutes?: number | null;
          due_date?: string | null;
          finished_at?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

// Atalhos usados pela aplicação.
type Tables = Database['public']['Tables'];

export type OrganizationRow = Tables['organizations']['Row'];
export type ProfileRow = Tables['profiles']['Row'];
export type ClientRow = Tables['clients']['Row'];
export type ClientUserRow = Tables['client_users']['Row'];
export type ProjectRow = Tables['projects']['Row'];
export type ProjectUserRow = Tables['project_users']['Row'];
export type ProjectGoalRow = Tables['project_goals']['Row'];
export type ProjectSettingsRow = Tables['project_settings']['Row'];
export type AuditLogRow = Tables['audit_logs']['Row'];
export type MetaIntegrationRow = Tables['meta_integrations']['Row'];
export type MetaInsightDailyRow = Tables['meta_insights_daily']['Row'];
export type MetaAdInsightDailyRow = Tables['meta_ad_insights_daily']['Row'];
export type MetaEntityRow = Tables['meta_entities']['Row'];
export type ContactRow = Tables['contacts']['Row'];
export type LeadEventRow = Tables['lead_events']['Row'];
export type SaleRow = Tables['sales']['Row'];
export type SellerRow = Tables['sellers']['Row'];
export type ClientRankingSettingsRow = Tables['client_ranking_settings']['Row'];
export type SellerPointAdjustmentRow = Tables['seller_point_adjustments']['Row'];
export type WebhookInboxRow = Tables['webhook_inbox']['Row'];
export type ProjectIntegrationRow = Tables['project_integrations']['Row'];
export type AgencyTaskRow = Tables['agency_tasks']['Row'];
