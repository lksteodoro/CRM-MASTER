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
      agency_tool_permissions: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string;
          tool_key: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id: string;
          tool_key: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          user_id?: string;
          tool_key?: string;
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
      client_disparo_profiles: {
        Row: {
          client_id: string;
          organization_id: string;
          profile_name: string | null;
          default_ddd: string | null;
          profile_photo_path: string | null;
          profile_cover_path: string | null;
          updated_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          client_id: string;
          organization_id?: string;
          profile_name?: string | null;
          default_ddd?: string | null;
          profile_photo_path?: string | null;
          profile_cover_path?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          client_id?: string;
          organization_id?: string;
          profile_name?: string | null;
          default_ddd?: string | null;
          profile_photo_path?: string | null;
          profile_cover_path?: string | null;
          updated_by?: string | null;
          created_at?: string;
          updated_at?: string;
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
          custom_fields: Json;
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
          custom_fields?: Json;
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
          custom_fields?: Json;
        };
        Relationships: [];
      };
      project_custom_fields: {
        Row: { id: string; project_id: string; entity_type: string; field_key: string; label: string; data_type: string; active: boolean; created_at: string };
        Insert: { id?: string; project_id: string; entity_type: string; field_key: string; label: string; data_type?: string; active?: boolean; created_at?: string };
        Update: { id?: string; project_id?: string; entity_type?: string; field_key?: string; label?: string; data_type?: string; active?: boolean; created_at?: string };
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
          custom_fields: Json;
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
          custom_fields?: Json;
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
          custom_fields?: Json;
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
          outbound_clicks: number;
          reach: number;
          frequency: number;
          ctr: number;
          cpc: number;
          cpm: number;
          leads: number;
          landing_page_views: number;
          post_engagement: number;
          video_views: number;
          thruplays: number;
          purchases: number;
          purchase_value: number;
          messaging_conversations_started: number;
          purchase_roas: number;
          actions: Json;
          action_values: Json;
          cost_per_action_type: Json;
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
          outbound_clicks?: number;
          reach?: number;
          frequency?: number;
          ctr?: number;
          cpc?: number;
          cpm?: number;
          leads?: number;
          landing_page_views?: number;
          post_engagement?: number;
          video_views?: number;
          thruplays?: number;
          purchases?: number;
          purchase_value?: number;
          messaging_conversations_started?: number;
          purchase_roas?: number;
          actions?: Json;
          action_values?: Json;
          cost_per_action_type?: Json;
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
          outbound_clicks?: number;
          reach?: number;
          frequency?: number;
          ctr?: number;
          cpc?: number;
          cpm?: number;
          leads?: number;
          landing_page_views?: number;
          post_engagement?: number;
          video_views?: number;
          thruplays?: number;
          purchases?: number;
          purchase_value?: number;
          messaging_conversations_started?: number;
          purchase_roas?: number;
          actions?: Json;
          action_values?: Json;
          cost_per_action_type?: Json;
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
          outbound_clicks: number;
          reach: number;
          frequency: number;
          ctr: number;
          cpc: number;
          cpm: number;
          leads: number;
          landing_page_views: number;
          post_engagement: number;
          video_views: number;
          thruplays: number;
          purchases: number;
          purchase_value: number;
          messaging_conversations_started: number;
          purchase_roas: number;
          actions: Json;
          action_values: Json;
          cost_per_action_type: Json;
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
          outbound_clicks?: number;
          reach?: number;
          frequency?: number;
          ctr?: number;
          cpc?: number;
          cpm?: number;
          leads?: number;
          landing_page_views?: number;
          post_engagement?: number;
          video_views?: number;
          thruplays?: number;
          purchases?: number;
          purchase_value?: number;
          messaging_conversations_started?: number;
          purchase_roas?: number;
          actions?: Json;
          action_values?: Json;
          cost_per_action_type?: Json;
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
          outbound_clicks?: number;
          reach?: number;
          frequency?: number;
          ctr?: number;
          cpc?: number;
          cpm?: number;
          leads?: number;
          landing_page_views?: number;
          post_engagement?: number;
          video_views?: number;
          thruplays?: number;
          purchases?: number;
          purchase_value?: number;
          messaging_conversations_started?: number;
          purchase_roas?: number;
          actions?: Json;
          action_values?: Json;
          cost_per_action_type?: Json;
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

      disparo_tags: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          color: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id?: string;
          name: string;
          color?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          color?: string;
          created_at?: string;
        };
        Relationships: [];
      };

      disparo_tasks: {
        Row: {
          id: string;
          organization_id: string;
          created_by: string;
          client_id: string | null;
          title: string;
          scheduled_date: string | null;
          scheduled_time: string | null;
          status:
            | 'pedido'
            | 'pagamento'
            | 'numero_perfil'
            | 'template_midia'
            | 'lista'
            | 'teste'
            | 'disparo'
            | 'finalizado';
          position: number;
          contact_list_ref: string | null;
          list_tag: string | null;
          full_link: string | null;
          short_link: string | null;
          instagram: string | null;
          copy_text: string | null;
          copy_approved: boolean;
          final_report: string | null;
          profile_photo_url: string | null;
          image_url: string | null;
          video_url: string | null;
          list_file_url: string | null;
          list_file_name: string | null;
          request_source: 'agency' | 'client_portal';
          client_submitted_at: string | null;
          client_notes: string | null;
          profile_name_snapshot: string | null;
          profile_ddd_snapshot: string | null;
          profile_photo_path: string | null;
          profile_cover_path: string | null;
          source_list_path: string | null;
          source_list_file_name: string | null;
          source_list_mime_type: string | null;
          list_original_count: number;
          list_valid_count: number;
          list_invalid_count: number;
          list_duplicate_count: number;
          client_portal_status: 'submitted' | 'under_review' | 'action_required' | 'approved';
          client_feedback_comment: string | null;
          client_feedback_at: string | null;
          client_feedback_by: string | null;
          contracted_quantity: number;
          sent_quantity: number;
          client_revenue: number;
          supplier_unit_cost: number;
          checklist: Record<string, boolean>;
          finished_at: string | null;
          archived_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id?: string;
          created_by?: string;
          client_id?: string | null;
          title: string;
          scheduled_date?: string | null;
          scheduled_time?: string | null;
          status?:
            | 'pedido'
            | 'pagamento'
            | 'numero_perfil'
            | 'template_midia'
            | 'lista'
            | 'teste'
            | 'disparo'
            | 'finalizado';
          position?: number;
          contact_list_ref?: string | null;
          list_tag?: string | null;
          full_link?: string | null;
          short_link?: string | null;
          instagram?: string | null;
          copy_text?: string | null;
          copy_approved?: boolean;
          final_report?: string | null;
          profile_photo_url?: string | null;
          image_url?: string | null;
          video_url?: string | null;
          list_file_url?: string | null;
          list_file_name?: string | null;
          request_source?: 'agency' | 'client_portal';
          client_submitted_at?: string | null;
          client_notes?: string | null;
          profile_name_snapshot?: string | null;
          profile_ddd_snapshot?: string | null;
          profile_photo_path?: string | null;
          profile_cover_path?: string | null;
          source_list_path?: string | null;
          source_list_file_name?: string | null;
          source_list_mime_type?: string | null;
          list_original_count?: number;
          list_valid_count?: number;
          list_invalid_count?: number;
          list_duplicate_count?: number;
          client_portal_status?: 'submitted' | 'under_review' | 'action_required' | 'approved';
          client_feedback_comment?: string | null;
          client_feedback_at?: string | null;
          client_feedback_by?: string | null;
          contracted_quantity?: number;
          sent_quantity?: number;
          client_revenue?: number;
          supplier_unit_cost?: number;
          checklist?: Record<string, boolean>;
          finished_at?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          created_by?: string;
          client_id?: string | null;
          title?: string;
          scheduled_date?: string | null;
          scheduled_time?: string | null;
          status?:
            | 'pedido'
            | 'pagamento'
            | 'numero_perfil'
            | 'template_midia'
            | 'lista'
            | 'teste'
            | 'disparo'
            | 'finalizado';
          position?: number;
          contact_list_ref?: string | null;
          list_tag?: string | null;
          full_link?: string | null;
          short_link?: string | null;
          instagram?: string | null;
          copy_text?: string | null;
          copy_approved?: boolean;
          final_report?: string | null;
          profile_photo_url?: string | null;
          image_url?: string | null;
          video_url?: string | null;
          list_file_url?: string | null;
          list_file_name?: string | null;
          request_source?: 'agency' | 'client_portal';
          client_submitted_at?: string | null;
          client_notes?: string | null;
          profile_name_snapshot?: string | null;
          profile_ddd_snapshot?: string | null;
          profile_photo_path?: string | null;
          profile_cover_path?: string | null;
          source_list_path?: string | null;
          source_list_file_name?: string | null;
          source_list_mime_type?: string | null;
          list_original_count?: number;
          list_valid_count?: number;
          list_invalid_count?: number;
          list_duplicate_count?: number;
          client_portal_status?: 'submitted' | 'under_review' | 'action_required' | 'approved';
          client_feedback_comment?: string | null;
          client_feedback_at?: string | null;
          client_feedback_by?: string | null;
          contracted_quantity?: number;
          sent_quantity?: number;
          client_revenue?: number;
          supplier_unit_cost?: number;
          checklist?: Record<string, boolean>;
          finished_at?: string | null;
          archived_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      disparo_task_numbers: {
        Row: {
          id: string;
          disparo_task_id: string;
          waba_label: string | null;
          number: string;
          name: string | null;
          is_test: boolean;
          position: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          disparo_task_id: string;
          waba_label?: string | null;
          number: string;
          name?: string | null;
          is_test?: boolean;
          position?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          disparo_task_id?: string;
          waba_label?: string | null;
          number?: string;
          name?: string | null;
          is_test?: boolean;
          position?: number;
          created_at?: string;
        };
        Relationships: [];
      };

      disparo_task_tags: {
        Row: {
          disparo_task_id: string;
          tag_id: string;
        };
        Insert: {
          disparo_task_id: string;
          tag_id: string;
        };
        Update: {
          disparo_task_id?: string;
          tag_id?: string;
        };
        Relationships: [];
      };

      disparo_financial_settings: {
        Row: {
          organization_id: string;
          supplier_unit_cost: number;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          organization_id?: string;
          supplier_unit_cost?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          organization_id?: string;
          supplier_unit_cost?: number;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      infobip_deposits: {
        Row: {
          id: string;
          organization_id: string;
          created_by: string | null;
          amount: number;
          deposited_at: string;
          status: 'pending' | 'confirmed' | 'cancelled';
          reference: string | null;
          notes: string | null;
          receipt_path: string | null;
          receipt_file_name: string | null;
          receipt_content_type: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id?: string;
          created_by?: string | null;
          amount: number;
          deposited_at?: string;
          status?: 'pending' | 'confirmed' | 'cancelled';
          reference?: string | null;
          notes?: string | null;
          receipt_path?: string | null;
          receipt_file_name?: string | null;
          receipt_content_type?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          created_by?: string | null;
          amount?: number;
          deposited_at?: string;
          status?: 'pending' | 'confirmed' | 'cancelled';
          reference?: string | null;
          notes?: string | null;
          receipt_path?: string | null;
          receipt_file_name?: string | null;
          receipt_content_type?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      redirect_links: {
        Row: {
          id: string;
          organization_id: string;
          client_id: string;
          name: string;
          slug: string;
          strategy: 'single' | 'round_robin';
          delay_seconds: number;
          active: boolean;
          paid_ads_locked: boolean;
          hit_count: number;
          last_accessed_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id?: string;
          client_id: string;
          name: string;
          slug: string;
          strategy?: 'single' | 'round_robin';
          delay_seconds?: number;
          active?: boolean;
          paid_ads_locked?: boolean;
          hit_count?: number;
          last_accessed_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          client_id?: string;
          name?: string;
          slug?: string;
          strategy?: 'single' | 'round_robin';
          delay_seconds?: number;
          active?: boolean;
          paid_ads_locked?: boolean;
          hit_count?: number;
          last_accessed_at?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };

      redirect_destinations: {
        Row: {
          id: string;
          redirect_link_id: string;
          label: string | null;
          target_url: string;
          position: number;
          hit_count: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          redirect_link_id: string;
          label?: string | null;
          target_url: string;
          position?: number;
          hit_count?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          redirect_link_id?: string;
          label?: string | null;
          target_url?: string;
          position?: number;
          hit_count?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      infobip_senders: {
        Row: { id: string; organization_id: string; client_id: string | null; label: string; sender: string; waba_id: string | null; waba_label: string | null; active: boolean; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id?: string; client_id?: string | null; label: string; sender: string; waba_id?: string | null; waba_label?: string | null; active?: boolean; created_at?: string; updated_at?: string };
        Update: { id?: string; organization_id?: string; client_id?: string | null; label?: string; sender?: string; waba_id?: string | null; waba_label?: string | null; active?: boolean; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      infobip_template_models: {
        Row: { id: string; organization_id: string; client_id: string | null; display_name: string; name_pattern: string; language: string; category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'; body_text: string; variable_examples: string[]; header_type: 'NONE' | 'IMAGE' | 'VIDEO'; header_media_url: string | null; footer_text: string | null; button_text: string | null; button_url: string | null; active: boolean; created_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id?: string; client_id?: string | null; display_name: string; name_pattern?: string; language?: string; category?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'; body_text: string; variable_examples?: string[]; header_type?: 'NONE' | 'IMAGE' | 'VIDEO'; header_media_url?: string | null; footer_text?: string | null; button_text?: string | null; button_url?: string | null; active?: boolean; created_by?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; organization_id?: string; client_id?: string | null; display_name?: string; name_pattern?: string; language?: string; category?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'; body_text?: string; variable_examples?: string[]; header_type?: 'NONE' | 'IMAGE' | 'VIDEO'; header_media_url?: string | null; footer_text?: string | null; button_text?: string | null; button_url?: string | null; active?: boolean; created_by?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      infobip_template_submissions: {
        Row: { id: string; organization_id: string; model_id: string; sender_id: string | null; sender: string; resolved_name: string; destination_url: string | null; status: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED'; provider_template_id: string | null; provider_status: string | null; requested_category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | null; provider_category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | null; category_changed: boolean; status_checked_at: string | null; provider_response: Json | null; error_message: string | null; created_by: string | null; requested_at: string; sent_at: string | null };
        Insert: { id?: string; organization_id?: string; model_id: string; sender_id?: string | null; sender: string; resolved_name: string; destination_url?: string | null; status?: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED'; provider_template_id?: string | null; provider_status?: string | null; requested_category?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | null; provider_category?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | null; category_changed?: boolean; status_checked_at?: string | null; provider_response?: Json | null; error_message?: string | null; created_by?: string | null; requested_at?: string; sent_at?: string | null };
        Update: { status?: 'QUEUED' | 'SENDING' | 'SENT' | 'FAILED'; provider_template_id?: string | null; provider_status?: string | null; requested_category?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | null; provider_category?: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | null; category_changed?: boolean; status_checked_at?: string | null; provider_response?: Json | null; error_message?: string | null; sent_at?: string | null };
        Relationships: [];
      };
      infobip_broadcast_drafts: {
        Row: { id: string; organization_id: string; name: string; sender: string; status: 'DRAFT' | 'READY' | 'SENDING' | 'FINISHED' | 'FAILED'; total_leads: number; created_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; organization_id?: string; name: string; sender: string; status?: 'DRAFT' | 'READY' | 'SENDING' | 'FINISHED' | 'FAILED'; total_leads?: number; created_by?: string | null; created_at?: string; updated_at?: string };
        Update: { name?: string; sender?: string; status?: 'DRAFT' | 'READY' | 'SENDING' | 'FINISHED' | 'FAILED'; total_leads?: number; updated_at?: string };
        Relationships: [];
      };
      infobip_broadcast_items: {
        Row: { id: string; organization_id: string; draft_id: string; label: string; file_name: string | null; file_url: string | null; lead_count: number | null; infobip_tag_id: string | null; infobip_tag_name: string | null; infobip_tag_people_count: number | null; template_id: string; template_name: string; template_language: string; position: number; status: 'DRAFT' | 'READY' | 'SENDING' | 'FINISHED' | 'FAILED'; created_at: string };
        Insert: { id?: string; organization_id?: string; draft_id: string; label: string; file_name?: string | null; file_url?: string | null; lead_count?: number | null; infobip_tag_id?: string | null; infobip_tag_name?: string | null; infobip_tag_people_count?: number | null; template_id: string; template_name: string; template_language: string; position?: number; status?: 'DRAFT' | 'READY' | 'SENDING' | 'FINISHED' | 'FAILED'; created_at?: string };
        Update: { label?: string; file_name?: string | null; file_url?: string | null; lead_count?: number | null; infobip_tag_id?: string | null; infobip_tag_name?: string | null; infobip_tag_people_count?: number | null; template_id?: string; template_name?: string; template_language?: string; position?: number; status?: 'DRAFT' | 'READY' | 'SENDING' | 'FINISHED' | 'FAILED' };
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      import_leads_batch: {
        Args: { p_project_id: string; p_rows: Json };
        Returns: Array<{ inserted_count: number; updated_count: number; invalid_count: number }>;
      };
      import_sales_batch: {
        Args: { p_project_id: string; p_rows: Json };
        Returns: Array<{ inserted_count: number; skipped_count: number; invalid_count: number }>;
      };
      resolve_redirect_link: {
        Args: { p_slug: string };
        Returns: Array<{ target_url: string; delay_seconds: number; link_name: string }>;
      };
      set_user_agency_tool_permissions: {
        Args: { p_user_id: string; p_tool_keys: string[] };
        Returns: undefined;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};

// Atalhos usados pela aplicação.
type Tables = Database['public']['Tables'];

export type OrganizationRow = Tables['organizations']['Row'];
export type ProfileRow = Tables['profiles']['Row'];
export type AgencyToolPermissionRow = Tables['agency_tool_permissions']['Row'];
export type ClientRow = Tables['clients']['Row'];
export type ClientUserRow = Tables['client_users']['Row'];
export type ClientDisparoProfileRow = Tables['client_disparo_profiles']['Row'];
export type ProjectRow = Tables['projects']['Row'];
export type ProjectUserRow = Tables['project_users']['Row'];
export type ProjectGoalRow = Tables['project_goals']['Row'];
export type ProjectSettingsRow = Tables['project_settings']['Row'];
export type AuditLogRow = Tables['audit_logs']['Row'];
export type MetaIntegrationRow = Tables['meta_integrations']['Row'];
export type RedirectLinkRow = Tables['redirect_links']['Row'];
export type RedirectDestinationRow = Tables['redirect_destinations']['Row'];
export type MetaInsightDailyRow = Tables['meta_insights_daily']['Row'];
export type MetaAdInsightDailyRow = Tables['meta_ad_insights_daily']['Row'];
export type MetaEntityRow = Tables['meta_entities']['Row'];
export type ContactRow = Tables['contacts']['Row'];
export type LeadEventRow = Tables['lead_events']['Row'];
export type ProjectCustomFieldRow = Tables['project_custom_fields']['Row'];
export type SaleRow = Tables['sales']['Row'];
export type SellerRow = Tables['sellers']['Row'];
export type ClientRankingSettingsRow = Tables['client_ranking_settings']['Row'];
export type SellerPointAdjustmentRow = Tables['seller_point_adjustments']['Row'];
export type WebhookInboxRow = Tables['webhook_inbox']['Row'];
export type ProjectIntegrationRow = Tables['project_integrations']['Row'];
export type AgencyTaskRow = Tables['agency_tasks']['Row'];
export type DisparoTagRow = Tables['disparo_tags']['Row'];
export type DisparoTaskRow = Tables['disparo_tasks']['Row'];
export type DisparoTaskNumberRow = Tables['disparo_task_numbers']['Row'];
export type DisparoFinancialSettingsRow = Tables['disparo_financial_settings']['Row'];
export type InfobipDepositRow = Tables['infobip_deposits']['Row'];
export type InfobipSenderRow = Tables['infobip_senders']['Row'];
export type InfobipTemplateModelRow = Tables['infobip_template_models']['Row'];
export type InfobipTemplateSubmissionRow = Tables['infobip_template_submissions']['Row'];
