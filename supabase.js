import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey && supabaseUrl !== 'SUA_URL_DO_SUPABASE_AQUI');

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Helpers de sincronização e persistência
export async function fetchAllDataFromSupabase() {
  if (!supabase) return null;

  try {
    const [
      { data: stores },
      { data: categories },
      { data: users },
      { data: tickets },
      { data: alerts },
      { data: statuses },
      { data: priorities }
    ] = await Promise.all([
      supabase.from('stores').select('*'),
      supabase.from('categories').select('*'),
      supabase.from('app_users').select('*'),
      supabase.from('tickets').select('*'),
      supabase.from('alerts').select('*'),
      supabase.from('statuses').select('*').order('order', { ascending: true }),
      supabase.from('priorities').select('*').order('weight', { ascending: false })
    ]);

    return {
      stores: stores || [],
      categories: (categories || []).map(c => ({ ...c, slaHours: c.sla_hours })),
      users: (users || []).map(u => ({ ...u, storeId: u.store_id })),
      tickets: (tickets || []).map(t => ({
        ...t,
        categoryId: t.category_id,
        storeId: t.store_id,
        requesterId: t.requester_id,
        assigneeId: t.assignee_id,
        serviceNotes: t.service_notes,
        dueDate: t.due_date,
        attestedBy: t.attested_by,
        attestedAt: t.attested_at,
        createdAt: t.created_at,
        updatedAt: t.updated_at
      })),
      alerts: (alerts || []).map(a => ({
        ...a,
        storeId: a.store_id,
        categoryId: a.category_id,
        dueDate: a.due_date,
        linkedTicketId: a.linked_ticket_id,
        createdAt: a.created_at
      })),
      statuses: statuses || [],
      priorities: priorities || []
    };
  } catch (err) {
    console.error('Erro ao buscar dados do Supabase:', err);
    return null;
  }
}
