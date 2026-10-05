export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

type ProjectStatus = "active" | "completed" | "on_hold"
type InvoiceStatus = "pending" | "paid" | "partially_paid" | "void"
type VerificationStatus = "needs_review" | "verified" | "flagged"
type DerivedInvoiceStatus = "not_invoiced" | InvoiceStatus
/** Postgres numeric. Written as a 2-decimal string so sums never use JS floats. */
type Money = number | string

export type Database = {
  public: {
    Tables: {
      projects: {
        Row: {
          id: string
          name: string
          address: string | null
          client_name: string | null
          client_email: string | null
          builder_fee_percent: number
          retainage_percent: number
          status: ProjectStatus
          contract_amount: number | null
          share_token: string | null
          invoice_tracking: boolean
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          name: string
          address?: string | null
          client_name?: string | null
          client_email?: string | null
          builder_fee_percent?: number
          retainage_percent?: number
          status?: ProjectStatus
          contract_amount?: Money | null
          share_token?: string | null
          invoice_tracking?: boolean
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          name?: string
          address?: string | null
          client_name?: string | null
          client_email?: string | null
          builder_fee_percent?: number
          retainage_percent?: number
          status?: ProjectStatus
          contract_amount?: Money | null
          share_token?: string | null
          invoice_tracking?: boolean
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      client_payments: {
        Row: {
          id: string
          project_id: string
          received_date: string
          amount: number
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          project_id: string
          received_date: string
          amount: Money
          note?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          received_date?: string
          amount?: Money
          note?: string | null
          created_at?: string
        }
        Relationships: []
      }
      categories: {
        Row: {
          id: number
          code: number
          name: string
          sort_order: number
          is_active: boolean
          keywords: string[]
        }
        Insert: {
          id?: number
          code: number
          name: string
          sort_order: number
          is_active?: boolean
          keywords?: string[]
        }
        Update: {
          id?: number
          code?: number
          name?: string
          sort_order?: number
          is_active?: boolean
          keywords?: string[]
        }
        Relationships: []
      }
      project_budgets: {
        Row: {
          project_id: string
          category_id: number
          budget_amount: number
        }
        Insert: {
          project_id: string
          category_id: number
          budget_amount: Money
        }
        Update: {
          project_id?: string
          category_id?: number
          budget_amount?: Money
        }
        Relationships: []
      }
      invoices: {
        Row: {
          id: string
          project_id: string
          invoice_number: string
          invoice_date: string
          subtotal: number
          builder_fee: number
          retainage: number
          total_amount: number
          status: InvoiceStatus
          amount_paid: number
          paid_date: string | null
          file_path: string | null
          notes: string | null
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          project_id: string
          invoice_number: string
          invoice_date?: string
          subtotal?: Money
          builder_fee?: Money
          retainage?: Money
          total_amount?: Money
          status?: InvoiceStatus
          amount_paid?: Money
          paid_date?: string | null
          file_path?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          project_id?: string
          invoice_number?: string
          invoice_date?: string
          subtotal?: Money
          builder_fee?: Money
          retainage?: Money
          total_amount?: Money
          status?: InvoiceStatus
          amount_paid?: Money
          paid_date?: string | null
          file_path?: string | null
          notes?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          id: string
          project_id: string
          category_id: number | null
          vendor: string | null
          expense_date: string | null
          amount: number
          receipt_number: string | null
          description: string | null
          payment_method: string | null
          receipt_file_path: string
          receipt_file_hash: string
          receipt_thumbnail_path: string | null
          split_group_id: string | null
          invoice_id: string | null
          ai_extracted: Json | null
          ai_suggested_category_ids: number[] | null
          ai_confidence: number | null
          verification_status: VerificationStatus
          duplicate_of: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          billing_status: string
        }
        Insert: {
          id?: string
          project_id: string
          category_id?: number | null
          vendor?: string | null
          expense_date?: string | null
          amount?: Money
          receipt_number?: string | null
          description?: string | null
          payment_method?: string | null
          receipt_file_path: string
          receipt_file_hash: string
          receipt_thumbnail_path?: string | null
          split_group_id?: string | null
          invoice_id?: string | null
          ai_extracted?: Json | null
          ai_suggested_category_ids?: number[] | null
          ai_confidence?: number | null
          verification_status?: VerificationStatus
          duplicate_of?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          billing_status?: string
        }
        Update: {
          id?: string
          project_id?: string
          category_id?: number | null
          vendor?: string | null
          expense_date?: string | null
          amount?: Money
          receipt_number?: string | null
          description?: string | null
          payment_method?: string | null
          receipt_file_path?: string
          receipt_file_hash?: string
          receipt_thumbnail_path?: string | null
          split_group_id?: string | null
          invoice_id?: string | null
          ai_extracted?: Json | null
          ai_suggested_category_ids?: number[] | null
          ai_confidence?: number | null
          verification_status?: VerificationStatus
          duplicate_of?: string | null
          created_at?: string
          updated_at?: string
          created_by?: string | null
          billing_status?: string
        }
        Relationships: []
      }
      expense_audit: {
        Row: {
          id: string
          expense_id: string
          changed_by: string | null
          changed_at: string
          field: string
          old_value: string | null
          new_value: string | null
        }
        Insert: {
          id?: string
          expense_id: string
          changed_by?: string | null
          changed_at?: string
          field: string
          old_value?: string | null
          new_value?: string | null
        }
        Update: {
          id?: string
          expense_id?: string
          changed_by?: string | null
          changed_at?: string
          field?: string
          old_value?: string | null
          new_value?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      v_expense_rows: {
        Row: {
          id: string
          project_id: string
          category_id: number | null
          category_code: number | null
          category_name: string | null
          category_sort_order: number | null
          vendor: string | null
          expense_date: string | null
          amount: number
          receipt_number: string | null
          description: string | null
          payment_method: string | null
          receipt_file_path: string
          receipt_file_hash: string
          receipt_thumbnail_path: string | null
          split_group_id: string | null
          invoice_id: string | null
          invoice_number: string | null
          invoice_date: string | null
          invoice_record_status: InvoiceStatus | null
          invoice_total_amount: number | null
          invoice_file_path: string | null
          invoice_status: DerivedInvoiceStatus | null
          ai_extracted: Json | null
          ai_suggested_category_ids: number[] | null
          ai_confidence: number | null
          verification_status: VerificationStatus
          duplicate_of: string | null
          created_at: string
          updated_at: string
          created_by: string | null
          billing_status: string
        }
        Relationships: []
      }
      v_project_category_totals: {
        Row: {
          project_id: string
          category_id: number
          code: number
          name: string
          sort_order: number
          is_active: boolean
          total_spent: number
          budget: number | null
          variance: number | null
          receipt_count: number
        }
        Relationships: []
      }
      v_project_summary: {
        Row: {
          project_id: string
          name: string
          address: string | null
          client_name: string | null
          client_email: string | null
          status: ProjectStatus
          builder_fee_percent: number
          retainage_percent: number
          total_spent: number
          total_invoiced: number
          total_not_invoiced: number
          total_paid: number
          total_pending: number
          receipt_count: number
          needs_review_count: number
          builder_fee_amount: number
        }
        Relationships: []
      }
    }
    Functions: {
      has_company_access: {
        Args: Record<string, never>
        Returns: boolean
      }
      recalculate_invoice: {
        Args: { target: string }
        Returns: undefined
      }
    }
  }
}
