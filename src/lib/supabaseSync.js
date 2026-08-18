import { supabase, isSupabaseConfigured } from './supabase.js';

export { isSupabaseConfigured };

// Mapeamentos CamelCase <-> SnakeCase
export function toSnakeCase(item, type) {
  if (!item) return item;
  const res = { ...item };

  if (type === 'categories') {
    if ('slaHours' in res) { res.sla_hours = res.slaHours; delete res.slaHours; }
  }
  if (type === 'users') {
    if ('storeId' in res) { res.store_id = res.storeId; delete res.storeId; }
  }
  if (type === 'tickets') {
    if ('categoryId' in res) { res.category_id = res.categoryId; delete res.categoryId; }
    if ('storeId' in res) { res.store_id = res.storeId; delete res.storeId; }
    if ('requesterId' in res) { res.requester_id = res.requesterId; delete res.requesterId; }
    if ('assigneeId' in res) { res.assignee_id = res.assigneeId; delete res.assigneeId; }
    if ('serviceNotes' in res) { res.service_notes = res.serviceNotes; delete res.serviceNotes; }
    if ('dueDate' in res) { res.due_date = res.dueDate; delete res.dueDate; }
    if ('attestedBy' in res) { res.attested_by = res.attestedBy; delete res.attestedBy; }
    if ('attestedAt' in res) { res.attested_at = res.attestedAt; delete res.attestedAt; }
    if ('createdAt' in res) { res.created_at = res.createdAt; delete res.createdAt; }
    if ('updatedAt' in res) { res.updated_at = res.updatedAt; delete res.updatedAt; }
  }
  if (type === 'alerts') {
    if ('storeId' in res) { res.store_id = res.storeId; delete res.storeId; }
    if ('categoryId' in res) { res.category_id = res.categoryId; delete res.categoryId; }
    if ('dueDate' in res) { res.due_date = res.dueDate; delete res.dueDate; }
    if ('linkedTicketId' in res) { res.linked_ticket_id = res.linkedTicketId; delete res.linkedTicketId; }
    if ('createdAt' in res) { res.created_at = res.createdAt; delete res.createdAt; }
  }
  return res;
}

export function toCamelCase(item, type) {
  if (!item) return item;
  const res = { ...item };

  if (type === 'categories') {
    res.slaHours = res.sla_hours ?? res.slaHours ?? 48;
  }
  if (type === 'users') {
    res.storeId = res.store_id ?? res.storeId ?? '';
  }
  if (type === 'tickets') {
    res.categoryId = res.category_id ?? res.categoryId ?? '';
    res.storeId = res.store_id ?? res.storeId ?? '';
    res.requesterId = res.requester_id ?? res.requesterId ?? '';
    res.assigneeId = res.assignee_id ?? res.assigneeId ?? '';
    res.serviceNotes = res.service_notes ?? res.serviceNotes ?? '';
    res.dueDate = res.due_date ?? res.dueDate ?? '';
    res.attestedBy = res.attested_by ?? res.attestedBy ?? '';
    res.attestedAt = res.attested_at ?? res.attestedAt ?? '';
    res.createdAt = res.created_at ?? res.createdAt;
    res.updatedAt = res.updated_at ?? res.updatedAt;
    res.comments = Array.isArray(res.comments) ? res.comments : [];
    res.history = Array.isArray(res.history) ? res.history : [];
    res.attachments = Array.isArray(res.attachments) ? res.attachments : [];
  }
  if (type === 'alerts') {
    res.storeId = res.store_id ?? res.storeId ?? '';
    res.categoryId = res.category_id ?? res.categoryId ?? '';
    res.dueDate = res.due_date ?? res.dueDate ?? '';
    res.linkedTicketId = res.linked_ticket_id ?? res.linkedTicketId ?? '';
    res.createdAt = res.created_at ?? res.createdAt;
  }
  return res;
}

const TABLE_MAP = {
  stores: 'stores',
  categories: 'categories',
  users: 'app_users',
  tickets: 'tickets',
  alerts: 'alerts',
  statuses: 'statuses',
  priorities: 'priorities'
};

// Carrega todos os dados do Supabase
export async function loadSupabaseData() {
  if (!isSupabaseConfigured || !supabase) return null;

  try {
    const [
      { data: stores, error: e1 },
      { data: categories, error: e2 },
      { data: users, error: e3 },
      { data: tickets, error: e4 },
      { data: alerts, error: e5 },
      { data: statuses, error: e6 },
      { data: priorities, error: e7 }
    ] = await Promise.all([
      supabase.from('stores').select('*'),
      supabase.from('categories').select('*'),
      supabase.from('app_users').select('*'),
      supabase.from('tickets').select('*'),
      supabase.from('alerts').select('*'),
      supabase.from('statuses').select('*').order('order', { ascending: true }),
      supabase.from('priorities').select('*').order('weight', { ascending: false })
    ]);

    if (e1 || e2 || e3 || e4 || e5 || e6 || e7) {
      console.warn('Erro ao carregar dados do Supabase:', { e1, e2, e3, e4, e5, e6, e7 });
      return null;
    }

    return {
      stores: (stores || []).map(s => toCamelCase(s, 'stores')),
      categories: (categories || []).map(c => toCamelCase(c, 'categories')),
      users: (users || []).map(u => toCamelCase(u, 'users')),
      tickets: (tickets || []).map(t => toCamelCase(t, 'tickets')),
      alerts: (alerts || []).map(a => toCamelCase(a, 'alerts')),
      statuses: (statuses || []).map(s => toCamelCase(s, 'statuses')),
      priorities: (priorities || []).map(p => toCamelCase(p, 'priorities'))
    };
  } catch (err) {
    console.error('Falha na comunicação com Supabase:', err);
    return null;
  }
}

// Salva dados no Supabase quando alterados
export async function syncKeyToSupabase(key, items) {
  if (!isSupabaseConfigured || !supabase) return;
  const tableName = TABLE_MAP[key];
  if (!tableName || !Array.isArray(items)) return;

  try {
    const formatted = items.map(item => toSnakeCase(item, key));
    
    // Obter IDs existentes para deletar itens removidos
    const { data: existing } = await supabase.from(tableName).select('id');
    const existingIds = (existing || []).map(x => x.id);
    const newIds = new Set(formatted.map(x => x.id));
    const toDelete = existingIds.filter(id => !newIds.has(id));

    if (toDelete.length > 0) {
      await supabase.from(tableName).delete().in('id', toDelete);
    }

    if (formatted.length > 0) {
      const { error } = await supabase.from(tableName).upsert(formatted, { onConflict: 'id' });
      if (error) console.error(`Erro ao salvar ${tableName} no Supabase:`, error);
    }
  } catch (err) {
    console.error(`Erro de sincronização em ${tableName}:`, err);
  }
}

// Inicializa dados no Supabase se as tabelas principais estiverem vazias
export async function seedSupabaseIfEmpty(seed) {
  if (!isSupabaseConfigured || !supabase || !seed) return;

  try {
    const { count: usersCount } = await supabase.from('app_users').select('*', { count: 'exact', head: true });
    if (!usersCount || usersCount === 0) {
      console.log('🌱 Inicializando usuários padrão no Supabase...');
      if (seed.users?.length) await syncKeyToSupabase('users', seed.users);
    }

    const { count: storesCount } = await supabase.from('stores').select('*', { count: 'exact', head: true });
    if (!storesCount || storesCount === 0) {
      console.log('🌱 Inicializando lojas e categorias no Supabase...');
      if (seed.stores?.length) await syncKeyToSupabase('stores', seed.stores);
      if (seed.categories?.length) await syncKeyToSupabase('categories', seed.categories);
      if (seed.tickets?.length) await syncKeyToSupabase('tickets', seed.tickets);
      if (seed.alerts?.length) await syncKeyToSupabase('alerts', seed.alerts);
    }
  } catch (err) {
    console.error('Erro ao verificar/popular seed inicial:', err);
  }
}


// Inicia escuta Realtime
export function subscribeToSupabase(onUpdate) {
  if (!isSupabaseConfigured || !supabase) return () => {};

  const channel = supabase
    .channel('db-realtime-changes')
    .on('postgres_changes', { event: '*', schema: 'public' }, () => {
      onUpdate();
    })
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
