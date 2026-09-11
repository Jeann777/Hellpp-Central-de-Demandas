import {
  supabase,
  isSupabaseConfigured,
  signInWithSupabase,
  signOutFromSupabase,
  getSupabaseSession,
  onSupabaseAuthStateChange,
  fetchUserProfile,
  rpcAdminCreateOrUpdateUser,
  rpcAdminDeleteUser
} from './supabase.js';

export {
  isSupabaseConfigured,
  signInWithSupabase,
  signOutFromSupabase,
  getSupabaseSession,
  onSupabaseAuthStateChange,
  fetchUserProfile,
  rpcAdminCreateOrUpdateUser,
  rpcAdminDeleteUser
};

// Mapeamentos CamelCase <-> SnakeCase com Sanitização Estrita de Tipos e Foreign Keys
export function toSnakeCase(item, type) {
  if (!item) return item;

  if (type === 'users') {
    return {
      id: item.id,
      auth_id: item.authId || item.auth_id || null,
      name: item.name || '',
      email: item.email ? item.email.trim().toLowerCase() : '',
      role: item.role || 'loja',
      store_id: (item.storeId || item.store_id || '').trim() || null,
      created_at: item.created_at || item.createdAt || new Date().toISOString()
    };
  }

  if (type === 'stores') {
    return {
      id: item.id,
      name: item.name || '',
      code: item.code || '',
      city: item.city || '',
      uf: item.uf || '',
      address: item.address || '',
      active: item.active !== undefined ? Boolean(item.active) : true,
      created_at: item.created_at || item.createdAt || new Date().toISOString()
    };
  }

  if (type === 'categories') {
    return {
      id: item.id,
      name: item.name || '',
      icon: item.icon || '🔧',
      color: item.color || '#0E6E5D',
      sla_hours: Number(item.slaHours ?? item.sla_hours ?? 48),
      created_at: item.created_at || item.createdAt || new Date().toISOString()
    };
  }

  if (type === 'statuses') {
    return {
      id: item.id,
      label: item.label || '',
      color: item.color || '#2255C9',
      soft: item.soft || '#E5EBFB',
      closed: Boolean(item.closed),
      order: Number(item.order ?? 1)
    };
  }

  if (type === 'priorities') {
    return {
      id: item.id,
      label: item.label || '',
      color: item.color || '#6B7280',
      soft: item.soft || '#EEF0F3',
      weight: Number(item.weight ?? 1)
    };
  }

  if (type === 'tickets') {
    return {
      id: item.id,
      year: Number(item.year || new Date().getFullYear()),
      seq: Number(item.seq || 1),
      title: item.title || '',
      description: item.description || '',
      category_id: (item.categoryId || item.category_id || '').trim() || null,
      store_id: (item.storeId || item.store_id || '').trim() || null,
      priority: (item.priority || '').trim() || null,
      status: (item.status || '').trim() || null,
      requester_id: (item.requesterId || item.requester_id || '').trim() || null,
      assignee_id: (item.assigneeId || item.assignee_id || '').trim() || null,
      budget: item.budget !== undefined ? String(item.budget) : '',
      service_notes: item.serviceNotes || item.service_notes || '',
      due_date: item.dueDate || item.due_date || null,
      attested_by: item.attestedBy || item.attested_by || '',
      attested_at: item.attestedAt || item.attested_at || '',
      comments: Array.isArray(item.comments) ? item.comments : [],
      history: Array.isArray(item.history) ? item.history : [],
      attachments: Array.isArray(item.attachments) ? item.attachments : [],
      created_at: item.createdAt || item.created_at || new Date().toISOString(),
      updated_at: item.updatedAt || item.updated_at || new Date().toISOString()
    };
  }

  if (type === 'alerts') {
    return {
      id: item.id,
      title: item.title || '',
      store_id: (item.storeId || item.store_id || '').trim() || null,
      category_id: (item.categoryId || item.category_id || '').trim() || null,
      due_date: item.dueDate || item.due_date || '',
      recurrence: item.recurrence || 'none',
      status: item.status || 'ativo',
      notes: item.notes || '',
      linked_ticket_id: (item.linkedTicketId || item.linked_ticket_id || '').trim() || null,
      created_at: item.createdAt || item.created_at || new Date().toISOString()
    };
  }

  return { ...item };
}

export function toCamelCase(item, type) {
  if (!item) return item;
  const res = { ...item };

  if (type === 'categories') {
    res.slaHours = res.sla_hours ?? res.slaHours ?? 48;
  }
  if (type === 'users') {
    res.storeId = res.store_id || res.storeId || '';
    res.authId = res.auth_id || res.authId || null;
  }
  if (type === 'tickets') {
    res.categoryId = res.category_id || res.categoryId || '';
    res.storeId = res.store_id || res.storeId || '';
    res.requesterId = res.requester_id || res.requesterId || '';
    res.assigneeId = res.assignee_id || res.assigneeId || '';
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
    res.storeId = res.store_id || res.storeId || '';
    res.categoryId = res.category_id || res.categoryId || '';
    res.dueDate = res.due_date ?? res.dueDate ?? '';
    res.linkedTicketId = res.linked_ticket_id || res.linkedTicketId || '';
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
  if (!isSupabaseConfigured || !supabase) return { success: false, error: 'Supabase não configurado' };
  const tableName = TABLE_MAP[key];
  if (!tableName || !Array.isArray(items)) return { success: false, error: 'Tabela inválida ou dados não são array' };

  try {
    const formatted = items.map(item => toSnakeCase(item, key));

    if (formatted.length > 0) {
      let query = supabase.from(tableName).upsert(formatted, { onConflict: 'id' });
      const { data, error } = await query;

      if (error) {
        console.error(`❌ Erro ao salvar ${tableName} no Supabase:`, error);
        return { success: false, error };
      }
    }

    // Usuários são gravados individualmente. Nunca removemos usuários que não
    // estejam na cópia desta tela, pois ela pode estar desatualizada.
    if (key === 'users') return { success: true };

    // Exclusão de itens removidos (após o upsert para não quebrar)
    try {
      const { data: existing } = await supabase.from(tableName).select('id');
      const existingIds = (existing || []).map(x => x.id);
      const newIds = new Set(formatted.map(x => x.id));
      const toDelete = existingIds.filter(id => !newIds.has(id));

      if (toDelete.length > 0) {
        await supabase.from(tableName).delete().in('id', toDelete);
      }
    } catch (delErr) {
      console.warn(`Aviso na limpeza de registros excluídos em ${tableName}:`, delErr);
    }

    return { success: true };
  } catch (err) {
    console.error(`❌ Erro de sincronização em ${tableName}:`, err);
    return { success: false, error: err };
  }
}

export async function deleteUserFromSupabase(id) {
  if (!isSupabaseConfigured || !supabase) return { success: false, error: 'Supabase não configurado' };

  try {
    const res = await rpcAdminDeleteUser(id);
    if (!res.success) {
      const { error } = await supabase.from('app_users').delete().eq('id', id);
      if (error) return { success: false, error };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error };
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
