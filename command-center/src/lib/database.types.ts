// Generated from the Supabase project (jpr-local). Regenerate after schema changes.
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.18";
  };
  public: {
    Tables: {
      action_items: {
        Row: {
          candidate_id: string | null;
          candidate_job_id: string | null;
          company_id: string | null;
          contact_id: string | null;
          created_at: string;
          created_by: string | null;
          detail: string | null;
          due_on: string | null;
          id: string;
          job_id: string | null;
          kind: string;
          market_id: string | null;
          priority: number;
          resolved_at: string | null;
          resolved_by: string | null;
          status: Database["public"]["Enums"]["action_status"];
          title: string;
        };
        Insert: {
          candidate_id?: string | null;
          candidate_job_id?: string | null;
          company_id?: string | null;
          contact_id?: string | null;
          created_at?: string;
          created_by?: string | null;
          detail?: string | null;
          due_on?: string | null;
          id?: string;
          job_id?: string | null;
          kind?: string;
          market_id?: string | null;
          priority?: number;
          resolved_at?: string | null;
          resolved_by?: string | null;
          status?: Database["public"]["Enums"]["action_status"];
          title: string;
        };
        Update: Partial<Database["public"]["Tables"]["action_items"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "action_items_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "action_items_candidate_job_id_fkey";
            columns: ["candidate_job_id"];
            isOneToOne: false;
            referencedRelation: "candidate_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "action_items_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "action_items_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "action_items_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "action_items_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "action_items_resolved_by_fkey";
            columns: ["resolved_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      activities: {
        Row: {
          actor_id: string | null;
          brain_claimed_at: string | null;
          brain_note: string | null;
          brain_status: string | null;
          candidate_id: string | null;
          candidate_job_id: string | null;
          body: string | null;
          company_id: string | null;
          contact_id: string | null;
          deal_id: string | null;
          direction: string | null;
          duration_seconds: number | null;
          external_id: string | null;
          external_status: string | null;
          external_thread_id: string | null;
          phone_number: string | null;
          id: string;
          job_id: string | null;
          kind: string;
          market_id: string | null;
          occurred_at: string;
          summary: string;
        };
        Insert: {
          actor_id?: string | null;
          brain_claimed_at?: string | null;
          brain_note?: string | null;
          brain_status?: string | null;
          candidate_id?: string | null;
          candidate_job_id?: string | null;
          body?: string | null;
          company_id?: string | null;
          contact_id?: string | null;
          deal_id?: string | null;
          direction?: string | null;
          duration_seconds?: number | null;
          external_id?: string | null;
          external_status?: string | null;
          external_thread_id?: string | null;
          phone_number?: string | null;
          id?: string;
          job_id?: string | null;
          kind: string;
          market_id?: string | null;
          occurred_at?: string;
          summary: string;
        };
        Update: Partial<Database["public"]["Tables"]["activities"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "activities_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_actor_id_fkey";
            columns: ["actor_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_candidate_job_id_fkey";
            columns: ["candidate_job_id"];
            isOneToOne: false;
            referencedRelation: "candidate_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_deal_id_fkey";
            columns: ["deal_id"];
            isOneToOne: false;
            referencedRelation: "deals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activities_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
        ];
      };
      agreements: {
        Row: {
          candidate_ownership_months: number | null;
          company_id: string;
          created_at: string;
          end_date: string | null;
          fee_percent: number | null;
          id: string;
          monthly_price: number | null;
          notes: string | null;
          plan_name: string | null;
          search_capacity: number | null;
          start_date: string | null;
          status: Database["public"]["Enums"]["agreement_status"];
          type: Database["public"]["Enums"]["agreement_type"];
        };
        Insert: {
          candidate_ownership_months?: number | null;
          company_id: string;
          created_at?: string;
          end_date?: string | null;
          fee_percent?: number | null;
          id?: string;
          monthly_price?: number | null;
          notes?: string | null;
          plan_name?: string | null;
          search_capacity?: number | null;
          start_date?: string | null;
          status?: Database["public"]["Enums"]["agreement_status"];
          type: Database["public"]["Enums"]["agreement_type"];
        };
        Update: Partial<Database["public"]["Tables"]["agreements"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "agreements_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      candidate_jobs: {
        Row: {
          assigned_at: string;
          assigned_by: string | null;
          candidate_id: string;
          id: string;
          job_id: string;
          notes: string | null;
          stage: Database["public"]["Enums"]["pipeline_stage"];
          stage_changed_at: string;
        };
        Insert: {
          assigned_at?: string;
          assigned_by?: string | null;
          candidate_id: string;
          id?: string;
          job_id: string;
          notes?: string | null;
          stage?: Database["public"]["Enums"]["pipeline_stage"];
          stage_changed_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["candidate_jobs"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "candidate_jobs_assigned_by_fkey";
            columns: ["assigned_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_jobs_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidate_jobs_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      candidates: {
        Row: {
          city: string | null;
          contact_consent: boolean;
          contact_consent_at: string | null;
          contact_consent_note: string | null;
          created_at: string;
          current_employer: string | null;
          current_title: string | null;
          email: string | null;
          full_name: string;
          id: string;
          is_sample: boolean;
          linkedin_url: string | null;
          notes: string | null;
          phone: string | null;
          sms_opted_out_at: string | null;
          source: Database["public"]["Enums"]["candidate_source"];
          source_market_id: string | null;
          sourced_by: string | null;
          state: string | null;
          updated_at: string;
        };
        Insert: {
          city?: string | null;
          contact_consent?: boolean;
          contact_consent_at?: string | null;
          contact_consent_note?: string | null;
          created_at?: string;
          current_employer?: string | null;
          current_title?: string | null;
          email?: string | null;
          full_name: string;
          id?: string;
          is_sample?: boolean;
          linkedin_url?: string | null;
          notes?: string | null;
          phone?: string | null;
          sms_opted_out_at?: string | null;
          source?: Database["public"]["Enums"]["candidate_source"];
          source_market_id?: string | null;
          sourced_by?: string | null;
          state?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["candidates"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "candidates_source_market_id_fkey";
            columns: ["source_market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "candidates_sourced_by_fkey";
            columns: ["sourced_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: {
          city: string | null;
          created_at: string;
          created_by: string | null;
          id: string;
          is_sample: boolean;
          industry: string | null;
          market_id: string;
          name: string;
          short_name: string | null;
          notes: string | null;
          phone: string | null;
          status: Database["public"]["Enums"]["company_status"];
          updated_at: string;
          website: string | null;
        };
        Insert: {
          city?: string | null;
          created_at?: string;
          created_by?: string | null;
          id?: string;
          is_sample?: boolean;
          industry?: string | null;
          market_id: string;
          name: string;
          short_name?: string | null;
          notes?: string | null;
          phone?: string | null;
          status?: Database["public"]["Enums"]["company_status"];
          updated_at?: string;
          website?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["companies"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "companies_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "companies_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
        ];
      };
      contacts: {
        Row: {
          company_id: string;
          created_at: string;
          email: string | null;
          full_name: string;
          id: string;
          notes: string | null;
          phone: string | null;
          sms_opted_out_at: string | null;
          title: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          email?: string | null;
          full_name: string;
          id?: string;
          notes?: string | null;
          phone?: string | null;
          sms_opted_out_at?: string | null;
          title?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["contacts"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "contacts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      deals: {
        Row: {
          closed_at: string | null;
          company_id: string;
          contact_id: string | null;
          created_at: string;
          deal_type: Database["public"]["Enums"]["agreement_type"] | null;
          expected_close: string | null;
          id: string;
          market_id: string;
          next_step: string | null;
          next_step_on: string | null;
          notes: string | null;
          owner_id: string | null;
          stage: Database["public"]["Enums"]["deal_stage"];
          stage_changed_at: string;
          title: string;
          updated_at: string;
          value: number | null;
        };
        Insert: {
          closed_at?: string | null;
          company_id: string;
          contact_id?: string | null;
          created_at?: string;
          deal_type?: Database["public"]["Enums"]["agreement_type"] | null;
          expected_close?: string | null;
          id?: string;
          market_id: string;
          next_step?: string | null;
          next_step_on?: string | null;
          notes?: string | null;
          owner_id?: string | null;
          stage?: Database["public"]["Enums"]["deal_stage"];
          stage_changed_at?: string;
          title: string;
          updated_at?: string;
          value?: number | null;
        };
        Update: Partial<Database["public"]["Tables"]["deals"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "deals_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_contact_id_fkey";
            columns: ["contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "deals_owner_id_fkey";
            columns: ["owner_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      google_accounts: {
        Row: {
          connected_at: string;
          email: string;
          last_synced_at: string | null;
          scopes: string | null;
          staff_id: string;
          token_enc: string;
        };
        Insert: {
          connected_at?: string;
          email: string;
          last_synced_at?: string | null;
          scopes?: string | null;
          staff_id: string;
          token_enc: string;
        };
        Update: {
          connected_at?: string;
          email?: string;
          last_synced_at?: string | null;
          scopes?: string | null;
          staff_id?: string;
          token_enc?: string;
        };
        Relationships: [];
      };
      integration_snapshots: {
        Row: { data: Json; name: string; taken_at: string };
        Insert: { data: Json; name: string; taken_at?: string };
        Update: { data?: Json; name?: string; taken_at?: string };
        Relationships: [];
      };
      automation_settings: {
        Row: {
          id: boolean;
          automated_recruiting: boolean;
          eligible_after: string | null;
          changed_at: string | null;
          changed_by: string | null;
        };
        Insert: {
          id?: boolean;
          automated_recruiting?: boolean;
          eligible_after?: string | null;
          changed_at?: string | null;
          changed_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["automation_settings"]["Row"]>;
        Relationships: [];
      };
      followup_steps: {
        Row: {
          id: string;
          purpose: string;
          step_no: number;
          day_offset: number;
          channel: string;
          subject: string | null;
          body: string;
          active: boolean;
        };
        Insert: {
          id?: string;
          purpose?: string;
          step_no: number;
          day_offset?: number;
          channel: string;
          subject?: string | null;
          body: string;
          active?: boolean;
        };
        Update: Partial<Database["public"]["Tables"]["followup_steps"]["Row"]>;
        Relationships: [];
      };
      pursuits: {
        Row: {
          id: string;
          candidate_job_id: string;
          purpose: string;
          status: string;
          started_by: string | null;
          paused_at: string | null;
          started_at: string;
          ended_at: string | null;
          end_reason: string | null;
        };
        Insert: {
          id?: string;
          candidate_job_id: string;
          purpose?: string;
          status?: string;
          started_by?: string | null;
          paused_at?: string | null;
          started_at?: string;
          ended_at?: string | null;
          end_reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["pursuits"]["Row"]>;
        Relationships: [];
      };
      pursuit_steps: {
        Row: {
          id: string;
          pursuit_id: string;
          step_no: number;
          channel: string;
          subject: string | null;
          body: string;
          due_at: string;
          status: string;
          claimed_at: string | null;
          sent_at: string | null;
          note: string | null;
          activity_id: string | null;
        };
        Insert: {
          id?: string;
          pursuit_id: string;
          step_no: number;
          channel: string;
          subject?: string | null;
          body: string;
          due_at: string;
          status?: string;
          claimed_at?: string | null;
          sent_at?: string | null;
          note?: string | null;
          activity_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["pursuit_steps"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "pursuit_steps_pursuit_id_fkey";
            columns: ["pursuit_id"];
            isOneToOne: false;
            referencedRelation: "pursuits";
            referencedColumns: ["id"];
          },
        ];
      };
      jobs: {
        Row: {
          candidate_description: string | null;
          company_id: string;
          compensation: string | null;
          created_at: string;
          created_by: string | null;
          description: string | null;
          hiring_contact_id: string | null;
          id: string;
          internal_notes: string | null;
          location: string | null;
          market_id: string;
          opened_on: string;
          priority: number;
          schedule: string | null;
          status: Database["public"]["Enums"]["job_status"];
          title: string;
          updated_at: string;
          visibility: Database["public"]["Enums"]["job_visibility"];
        };
        Insert: {
          candidate_description?: string | null;
          company_id: string;
          compensation?: string | null;
          created_at?: string;
          created_by?: string | null;
          description?: string | null;
          hiring_contact_id?: string | null;
          id?: string;
          internal_notes?: string | null;
          location?: string | null;
          market_id: string;
          opened_on?: string;
          priority?: number;
          schedule?: string | null;
          status?: Database["public"]["Enums"]["job_status"];
          title: string;
          updated_at?: string;
          visibility?: Database["public"]["Enums"]["job_visibility"];
        };
        Update: Partial<Database["public"]["Tables"]["jobs"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "jobs_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_created_by_fkey";
            columns: ["created_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_hiring_contact_id_fkey";
            columns: ["hiring_contact_id"];
            isOneToOne: false;
            referencedRelation: "contacts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "jobs_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
        ];
      };
      markets: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          phone: string | null;
          slug: string;
          timezone: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name: string;
          phone?: string | null;
          slug: string;
          timezone?: string;
        };
        Update: Partial<Database["public"]["Tables"]["markets"]["Row"]>;
        Relationships: [];
      };
      placements: {
        Row: {
          candidate_job_id: string;
          compensation: number | null;
          covered_by_subscription: boolean;
          created_at: string;
          fee_amount: number | null;
          fee_percent: number | null;
          guarantee_until: string | null;
          id: string;
          invoice_status: Database["public"]["Enums"]["invoice_status"];
          invoiced_on: string | null;
          notes: string | null;
          paid_on: string | null;
          start_date: string | null;
          updated_at: string;
        };
        Insert: {
          candidate_job_id: string;
          compensation?: number | null;
          covered_by_subscription?: boolean;
          created_at?: string;
          fee_amount?: number | null;
          fee_percent?: number | null;
          guarantee_until?: string | null;
          id?: string;
          invoice_status?: Database["public"]["Enums"]["invoice_status"];
          invoiced_on?: string | null;
          notes?: string | null;
          paid_on?: string | null;
          start_date?: string | null;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["placements"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "placements_candidate_job_id_fkey";
            columns: ["candidate_job_id"];
            isOneToOne: true;
            referencedRelation: "candidate_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      resumes: {
        Row: {
          candidate_id: string;
          created_at: string;
          file_name: string;
          id: string;
          mime_type: string | null;
          size_bytes: number | null;
          storage_path: string | null;
          text_content: string | null;
          uploaded_by: string | null;
        };
        Insert: {
          candidate_id: string;
          created_at?: string;
          file_name: string;
          id?: string;
          mime_type?: string | null;
          size_bytes?: number | null;
          storage_path?: string | null;
          text_content?: string | null;
          uploaded_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["resumes"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "resumes_candidate_id_fkey";
            columns: ["candidate_id"];
            isOneToOne: false;
            referencedRelation: "candidates";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "resumes_uploaded_by_fkey";
            columns: ["uploaded_by"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
      screening_goals: {
        Row: {
          created_at: string;
          id: string;
          job_id: string;
          prompt: string;
          required: boolean;
          sort: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          job_id: string;
          prompt: string;
          required?: boolean;
          sort?: number;
        };
        Update: Partial<Database["public"]["Tables"]["screening_goals"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "screening_goals_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      screening_facts: {
        Row: {
          candidate_job_id: string;
          created_at: string;
          goal_id: string | null;
          id: string;
          label: string;
          run_id: string | null;
          sort: number;
          source: string;
          value: string | null;
        };
        Insert: {
          candidate_job_id: string;
          created_at?: string;
          goal_id?: string | null;
          id?: string;
          label: string;
          run_id?: string | null;
          sort?: number;
          source?: string;
          value?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["screening_facts"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "screening_facts_candidate_job_id_fkey";
            columns: ["candidate_job_id"];
            isOneToOne: false;
            referencedRelation: "candidate_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "screening_facts_goal_id_fkey";
            columns: ["goal_id"];
            isOneToOne: false;
            referencedRelation: "screening_goals";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "screening_facts_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "screening_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      screening_runs: {
        Row: {
          candidate_job_id: string;
          candidate_questions: string[];
          channel: string;
          concerns: string[];
          created_at: string;
          duration_seconds: number | null;
          ended_at: string | null;
          id: string;
          recording_url: string | null;
          scheduled_for: string | null;
          started_at: string | null;
          status: Database["public"]["Enums"]["screening_status"];
          summary: string | null;
          transcript: Json;
          unresolved: string[];
        };
        Insert: {
          candidate_job_id: string;
          candidate_questions?: string[];
          channel?: string;
          concerns?: string[];
          created_at?: string;
          duration_seconds?: number | null;
          ended_at?: string | null;
          id?: string;
          recording_url?: string | null;
          scheduled_for?: string | null;
          started_at?: string | null;
          status?: Database["public"]["Enums"]["screening_status"];
          summary?: string | null;
          transcript?: Json;
          unresolved?: string[];
        };
        Update: Partial<Database["public"]["Tables"]["screening_runs"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "screening_runs_candidate_job_id_fkey";
            columns: ["candidate_job_id"];
            isOneToOne: false;
            referencedRelation: "candidate_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
      submissions: {
        Row: {
          body: string;
          candidate_job_id: string;
          created_at: string;
          decided_at: string | null;
          decided_by: string | null;
          drafted_by: string;
          email_thread_id: string | null;
          id: string;
          run_id: string | null;
          sent_at: string | null;
          status: Database["public"]["Enums"]["submission_status"];
          subject: string;
          to_contact_ids: string[];
          updated_at: string;
        };
        Insert: {
          body?: string;
          candidate_job_id: string;
          created_at?: string;
          decided_at?: string | null;
          decided_by?: string | null;
          drafted_by?: string;
          email_thread_id?: string | null;
          id?: string;
          run_id?: string | null;
          sent_at?: string | null;
          status?: Database["public"]["Enums"]["submission_status"];
          subject?: string;
          to_contact_ids?: string[];
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["submissions"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "submissions_candidate_job_id_fkey";
            columns: ["candidate_job_id"];
            isOneToOne: false;
            referencedRelation: "candidate_jobs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "submissions_run_id_fkey";
            columns: ["run_id"];
            isOneToOne: false;
            referencedRelation: "screening_runs";
            referencedColumns: ["id"];
          },
        ];
      };
      services: {
        Row: {
          account_email: string | null;
          billing: Database["public"]["Enums"]["billing_cycle"];
          category: string;
          cost: number | null;
          created_at: string;
          id: string;
          login_url: string | null;
          name: string;
          notes: string | null;
          plan: string | null;
          purpose: string | null;
          renews_on: string | null;
          sort: number;
          status: Database["public"]["Enums"]["service_status"];
          updated_at: string;
          watch: string | null;
        };
        Insert: {
          account_email?: string | null;
          billing?: Database["public"]["Enums"]["billing_cycle"];
          category?: string;
          cost?: number | null;
          created_at?: string;
          id?: string;
          login_url?: string | null;
          name: string;
          notes?: string | null;
          plan?: string | null;
          purpose?: string | null;
          renews_on?: string | null;
          sort?: number;
          status?: Database["public"]["Enums"]["service_status"];
          updated_at?: string;
          watch?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["services"]["Row"]>;
        Relationships: [];
      };
      staff: {
        Row: {
          active: boolean;
          created_at: string;
          email: string;
          full_name: string | null;
          id: string;
          phone: string | null;
          role: Database["public"]["Enums"]["staff_role"];
        };
        Insert: {
          active?: boolean;
          created_at?: string;
          email: string;
          full_name?: string | null;
          id: string;
          phone?: string | null;
          role?: Database["public"]["Enums"]["staff_role"];
        };
        Update: Partial<Database["public"]["Tables"]["staff"]["Row"]>;
        Relationships: [];
      };
      staff_invites: {
        Row: {
          created_at: string;
          email: string;
          full_name: string | null;
          market_ids: string[];
          role: Database["public"]["Enums"]["staff_role"];
        };
        Insert: {
          created_at?: string;
          email: string;
          full_name?: string | null;
          market_ids?: string[];
          role?: Database["public"]["Enums"]["staff_role"];
        };
        Update: Partial<Database["public"]["Tables"]["staff_invites"]["Row"]>;
        Relationships: [];
      };
      staff_markets: {
        Row: {
          market_id: string;
          staff_id: string;
        };
        Insert: {
          market_id: string;
          staff_id: string;
        };
        Update: Partial<Database["public"]["Tables"]["staff_markets"]["Row"]>;
        Relationships: [
          {
            foreignKeyName: "staff_markets_market_id_fkey";
            columns: ["market_id"];
            isOneToOne: false;
            referencedRelation: "markets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "staff_markets_staff_id_fkey";
            columns: ["staff_id"];
            isOneToOne: false;
            referencedRelation: "staff";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      needs_me: {
        Row: {
          candidate_id: string | null;
          candidate_job_id: string | null;
          company_id: string | null;
          detail: string | null;
          job_id: string | null;
          key: string | null;
          kind: string | null;
          market_id: string | null;
          priority: number | null;
          since: string | null;
          title: string | null;
        };
        Relationships: [];
      };
    };
    Functions: {
      can_access_market: { Args: { m: string }; Returns: boolean };
      is_owner: { Args: never; Returns: boolean };
      is_protected_employer: { Args: { employer: string }; Returns: boolean };
      is_staff: { Args: never; Returns: boolean };
      phone_key: { Args: { p: string }; Returns: string };
      set_automated_recruiting: { Args: { p_on: boolean }; Returns: undefined };
      start_pursuit: { Args: { p_candidate_job_id: string; p_purpose?: string }; Returns: string | null };
      brain_pending: { Args: { p_secret: string }; Returns: Json };
      brain_apply: { Args: { p_secret: string; p_activity: string; p_decision: Json }; Returns: string };
      set_outreach: { Args: { p_candidate_job_id: string; p_on: boolean; p_purpose?: string }; Returns: string };
      automation_register: { Args: { p_secret: string; p_url: string }; Returns: undefined };
      automation_due: { Args: { p_secret: string }; Returns: Json };
      automation_step_done: {
        Args: {
          p_secret: string;
          p_step: string;
          p_status: string;
          p_note: string;
          p_summary: string;
          p_body: string;
          p_external_id: string;
          p_thread_id: string;
          p_phone: string;
        };
        Returns: undefined;
      };
      gmail_mailboxes: { Args: { p_secret: string }; Returns: Json };
      gmail_known: { Args: { p_secret: string; p_ids: string[] }; Returns: string[] };
      gmail_log: { Args: { p_secret: string; p_staff: string; p_me: string; p_msgs: Json; p_synced_at: string }; Returns: number };
      twilio_inbound_text: { Args: { p_secret: string; p_sid: string; p_from: string; p_to: string; p_body: string }; Returns: undefined };
      twilio_caller_name: { Args: { p_secret: string; p_from: string }; Returns: string | null };
      twilio_inbound_call: { Args: { p_secret: string; p_sid: string; p_from: string }; Returns: undefined };
      twilio_forward_number: { Args: { p_secret: string }; Returns: string | null };
      twilio_relay_target: { Args: { p_secret: string; p_name?: string }; Returns: { phone: string; name: string }[] };
      twilio_log_relay: { Args: { p_secret: string; p_sid: string; p_to: string; p_body: string }; Returns: undefined };
      twilio_status: { Args: { p_secret: string; p_sid: string; p_status: string; p_duration: number | null }; Returns: undefined };
    };
    Enums: {
      action_status: "open" | "done" | "dismissed";
      agreement_status: "draft" | "active" | "ended";
      agreement_type: "subscription" | "contingency";
      billing_cycle: "free" | "monthly" | "yearly" | "usage";
      candidate_source: "indeed" | "linkedin" | "website" | "referral" | "database" | "direct_outreach" | "inbound" | "other";
      company_status: "prospect" | "client" | "former_client";
      deal_stage: "lead" | "contacted" | "meeting" | "proposal" | "won" | "lost";
      invoice_status: "not_invoiced" | "invoiced" | "paid" | "not_applicable";
      job_status: "open" | "on_hold" | "filled" | "closed";
      job_visibility: "private" | "public" | "confidential";
      pipeline_stage:
        | "applied"
        | "assigned"
        | "contacting"
        | "conversation"
        | "ready_to_submit"
        | "submitted"
        | "interviewing"
        | "offer"
        | "placed"
        | "on_hold"
        | "passed"
        | "withdrawn";
      screening_status: "scheduled" | "in_progress" | "completed" | "no_answer" | "failed" | "cancelled";
      service_status: "active" | "planned" | "cancelled";
      submission_status: "draft" | "sent" | "held" | "passed";
      staff_role: "owner" | "regional_director" | "market_director" | "recruiter";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type PublicSchema = Database["public"];
export type Tables<T extends keyof PublicSchema["Tables"] | keyof PublicSchema["Views"]> = T extends keyof PublicSchema["Tables"]
  ? PublicSchema["Tables"][T]["Row"]
  : T extends keyof PublicSchema["Views"]
    ? PublicSchema["Views"][T]["Row"]
    : never;
export type Enums<T extends keyof PublicSchema["Enums"]> = PublicSchema["Enums"][T];

export const Constants = {
  public: {
    Enums: {
      action_status: ["open", "done", "dismissed"],
      agreement_status: ["draft", "active", "ended"],
      agreement_type: ["subscription", "contingency"],
      billing_cycle: ["free", "monthly", "yearly", "usage"],
      candidate_source: ["indeed", "linkedin", "website", "referral", "database", "direct_outreach", "inbound", "other"],
      company_status: ["prospect", "client", "former_client"],
      deal_stage: ["lead", "contacted", "meeting", "proposal", "won", "lost"],
      invoice_status: ["not_invoiced", "invoiced", "paid", "not_applicable"],
      job_status: ["open", "on_hold", "filled", "closed"],
      job_visibility: ["private", "public", "confidential"],
      pipeline_stage: [
        "applied",
        "assigned",
        "contacting",
        "conversation",
        "ready_to_submit",
        "submitted",
        "interviewing",
        "offer",
        "placed",
        "on_hold",
        "passed",
        "withdrawn",
      ],
      screening_status: ["scheduled", "in_progress", "completed", "no_answer", "failed", "cancelled"],
      service_status: ["active", "planned", "cancelled"],
      submission_status: ["draft", "sent", "held", "passed"],
      staff_role: ["owner", "regional_director", "market_director", "recruiter"],
    },
  },
} as const;
