import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'SUA_URL_DO_SUPABASE_AQUI' &&
  supabaseAnonKey.startsWith('eyJ')
);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

// Autenticação Real via Supabase Auth
export async function signInWithSupabase(email, password) {
  if (!supabase) return { data: null, error: new Error("Supabase não configurado") };
  const result = await supabase.auth.signInWithPassword({
    email: (email || '').trim().toLowerCase(),
    password: password || ''
  });
  if (result.error) {
    console.error('[Auth] Falha no login:', result.error.message);
  }
  return result;
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
// Estratégia: busca primeiro por auth_id (mais seguro), depois fallback por email exato.
// Retorna null se nenhum perfil for encontrado — impede login sem perfil cadastrado.
export async function fetchUserProfile(authUser) {
  if (!authUser || !supabase) return null;

  const authId = authUser.id;
  const authEmail = (authUser.email || '').trim().toLowerCase();

  try {
    // 1. Busca primária: por auth_id (vínculo direto, mais seguro)
    const { data: byAuthId, error: err1 } = await supabase
      .from('app_users')
      .select('*')
      .eq('auth_id', authId)
      .maybeSingle();

    if (err1) {
      console.warn('[Auth] Erro ao buscar perfil por auth_id:', err1.message);
    }

    if (byAuthId) {
      return buildProfile(byAuthId, authId);
    }

    // 2. Fallback: busca por email exato (case-insensitive)
    if (authEmail) {
      const { data: byEmail, error: err2 } = await supabase
        .from('app_users')
        .select('*')
        .ilike('email', authEmail)
        .maybeSingle();

      if (err2) {
        console.warn('[Auth] Erro ao buscar perfil por email:', err2.message);
      }

      if (byEmail) {
        // Vincula o auth_id ao perfil encontrado para futuras buscas diretas
        supabase
          .from('app_users')
          .update({ auth_id: authId })
          .eq('id', byEmail.id)
          .then(() => console.log('[Auth] auth_id vinculado ao perfil existente.'))
          .catch(() => {});

        return buildProfile(byEmail, authId);
      }
    }
  } catch (err) {
    console.error('[Auth] Erro inesperado ao buscar perfil:', err);
  }

  // Nenhum perfil encontrado — retorna null para impedir login fantasma
  console.warn('[Auth] Nenhum perfil encontrado em app_users para:', authEmail);
  return null;
}

function buildProfile(data, authId) {
  return {
    id: data.id,
    authId: authId,
    email: data.email,
    name: data.name || 'Usuário',
    role: data.role || 'loja',
    storeId: data.store_id || data.storeId || ''
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
    console.error("[Auth] Erro na criação/atualização segura de usuário via RPC:", err);
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
    console.error("[Auth] Erro na exclusão de usuário via RPC:", err);
    return { success: false, error: err.message || err };
  }
}
