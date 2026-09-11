import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey && supabaseUrl !== 'SUA_URL_DO_SUPABASE_AQUI');

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Autenticação Real via Supabase Auth
export async function signInWithSupabase(email, password) {
  if (!supabase) return { data: null, error: new Error("Supabase não configurado") };
  return await supabase.auth.signInWithPassword({
    email: (email || '').trim().toLowerCase(),
    password: password || ''
  });
}

export async function signOutFromSupabase() {
  if (!supabase) return { error: null };
  return await supabase.auth.signOut();
}

export async function getSupabaseSession() {
  if (!supabase) return { session: null, user: null };
  const { data: { session }, error } = await supabase.auth.getSession();
  if (error || !session) return { session: null, user: null };
  return { session, user: session.user };
}

export function onSupabaseAuthStateChange(callback) {
  if (!supabase) return { data: { subscription: { unsubscribe: () => {} } } };
  return supabase.auth.onAuthStateChange(callback);
}

// Busca o perfil do usuário na tabela app_users (com role, store_id e nome)
export async function fetchUserProfile(authUser) {
  if (!authUser || !supabase) return null;
  try {
    const authId = authUser.id;
    const authEmail = (authUser.email || '').trim().toLowerCase();

    const { data, error } = await supabase
      .from('app_users')
      .select('*')
      .or(`auth_id.eq.${authId},email.ilike.${authEmail}`)
      .limit(1)
      .maybeSingle();

    if (data) {
      if (!data.auth_id && authId) {
        supabase
          .from('app_users')
          .update({ auth_id: authId })
          .eq('id', data.id)
          .then(() => {})
          .catch(() => {});
      }

      return {
        id: data.id,
        authId: authId,
        email: data.email || authUser.email,
        name: data.name || authUser.user_metadata?.name || (authUser.email ? authUser.email.split('@')[0] : 'Usuário'),
        role: data.role || authUser.user_metadata?.role || 'loja',
        storeId: data.store_id || data.storeId || ''
      };
    }
  } catch (err) {
    console.warn('Erro ao buscar perfil em app_users:', err);
  }

  return {
    id: authUser.id,
    authId: authUser.id,
    email: authUser.email,
    name: authUser.user_metadata?.name || (authUser.email ? authUser.email.split('@')[0] : 'Usuário'),
    role: authUser.user_metadata?.role || 'loja',
    storeId: authUser.user_metadata?.store_id || ''
  };
}

// RPC Seguro: Criação/Atualização de Usuários pelo Administrador
export async function rpcAdminCreateOrUpdateUser({ id, email, password, name, role, storeId }) {
  if (!supabase) return { success: false, error: "Supabase não configurado" };
  try {
    const { data, error } = await supabase.rpc('admin_create_or_update_user', {
      p_id: id || '',
      p_email: email,
      p_password: password || '',
      p_name: name,
      p_role: role || 'loja',
      p_store_id: storeId || ''
    });
    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Erro na criação/atualização segura de usuário via RPC:", err);
    return { success: false, error: err.message || err };
  }
}

// RPC Seguro: Exclusão de Usuários pelo Administrador
export async function rpcAdminDeleteUser(userId) {
  if (!supabase) return { success: false, error: "Supabase não configurado" };
  try {
    const { data, error } = await supabase.rpc('admin_delete_user', {
      p_user_id: userId
    });
    if (error) throw error;
    return { success: true, data };
  } catch (err) {
    console.error("Erro na exclusão de usuário via RPC:", err);
    return { success: false, error: err.message || err };
  }
}
