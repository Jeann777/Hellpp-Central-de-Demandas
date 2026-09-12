-- ====================================================================
-- SCRIPT DE SEGURANÇA E MIGRAÇÃO: CENTRAL DE DEMANDAS (HELLPP)
-- Executar no Supabase SQL Editor
-- ====================================================================

-- 1. Habilitar extensões necessárias para criptografia de senhas
-- IMPORTANTE: No Supabase Cloud, pgcrypto fica no schema 'extensions'
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Garantir integridade da tabela de Lojas (stores)
CREATE TABLE IF NOT EXISTS public.stores (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    city TEXT,
    uf TEXT,
    address TEXT,
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tabela de Categorias (categories)
CREATE TABLE IF NOT EXISTS public.categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '🔧',
    color TEXT DEFAULT '#0E6E5D',
    sla_hours INTEGER DEFAULT 48,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Tabela de Status de O.S. (statuses)
CREATE TABLE IF NOT EXISTS public.statuses (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    color TEXT NOT NULL,
    soft TEXT NOT NULL,
    closed BOOLEAN DEFAULT false,
    "order" INTEGER DEFAULT 1
);

-- 5. Tabela de Prioridades (priorities)
CREATE TABLE IF NOT EXISTS public.priorities (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    color TEXT NOT NULL,
    soft TEXT NOT NULL,
    weight INTEGER DEFAULT 1
);

-- 6. Tabela de Usuários / Perfis (app_users)
CREATE TABLE IF NOT EXISTS public.app_users (
    id TEXT PRIMARY KEY,
    auth_id UUID,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    role TEXT NOT NULL DEFAULT 'loja', -- 'admin' ou 'loja'
    store_id TEXT REFERENCES public.stores(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Migração da tabela app_users caso já exista no banco:
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS auth_id UUID;
-- Adiciona role com DEFAULT antes de aplicar NOT NULL para evitar erros em tabelas existentes com dados
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'loja';
UPDATE public.app_users SET role = 'loja' WHERE role IS NULL;
ALTER TABLE public.app_users ALTER COLUMN role SET NOT NULL;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS store_id TEXT REFERENCES public.stores(id) ON DELETE SET NULL;
ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- Garante constraint UNIQUE no email para permitir ON CONFLICT (email)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conrelid = 'public.app_users'::regclass AND contype = 'u'
  ) THEN
    ALTER TABLE public.app_users ADD CONSTRAINT app_users_email_key UNIQUE (email);
  END IF;
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

-- Remover a coluna antiga de senha em texto puro (se existir)
ALTER TABLE public.app_users DROP COLUMN IF EXISTS password;

-- 7. Tabela de Demandas / O.S. (tickets)
CREATE TABLE IF NOT EXISTS public.tickets (
    id TEXT PRIMARY KEY,
    year INTEGER NOT NULL,
    seq INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    category_id TEXT REFERENCES public.categories(id) ON DELETE SET NULL,
    store_id TEXT REFERENCES public.stores(id) ON DELETE SET NULL,
    priority TEXT REFERENCES public.priorities(id) ON DELETE SET NULL,
    status TEXT REFERENCES public.statuses(id) ON DELETE SET NULL,
    requester_id TEXT,
    assignee_id TEXT,
    budget TEXT DEFAULT '',
    service_notes TEXT DEFAULT '',
    due_date TEXT,
    attested_by TEXT DEFAULT '',
    attested_at TEXT DEFAULT '',
    comments JSONB DEFAULT '[]'::jsonb,
    history JSONB DEFAULT '[]'::jsonb,
    attachments JSONB DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Tabela de Alertas Preventivos (alerts)
CREATE TABLE IF NOT EXISTS public.alerts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    store_id TEXT REFERENCES public.stores(id) ON DELETE SET NULL,
    category_id TEXT REFERENCES public.categories(id) ON DELETE SET NULL,
    due_date TEXT NOT NULL,
    recurrence TEXT DEFAULT 'none',
    status TEXT DEFAULT 'ativo',
    notes TEXT DEFAULT '',
    linked_ticket_id TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ====================================================================
-- FUNÇÕES DE APOIO E SEGURANÇA (SECURITY DEFINER)
-- ====================================================================

-- Função para verificar se o usuário logado no Supabase Auth é administrador
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE (auth_id = auth.uid() OR lower(email) = lower(auth.jwt()->>'email'))
      AND role = 'admin'
  );
$$;

-- Função para recuperar o store_id do usuário logado
CREATE OR REPLACE FUNCTION public.get_user_store_id()
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public, auth
AS $$
  SELECT store_id FROM public.app_users
  WHERE auth_id = auth.uid() OR lower(email) = lower(auth.jwt()->>'email')
  LIMIT 1;
$$;

-- Função Segura para o Administrador cadastrar/atualizar usuários com senha no Supabase Auth
-- CORREÇÃO: Inclui inserção em auth.identities (obrigatório para login email/senha)
--           e usa extensions.crypt() para compatibilidade com Supabase Cloud
CREATE OR REPLACE FUNCTION public.admin_create_or_update_user(
  p_id TEXT,
  p_email TEXT,
  p_password TEXT,
  p_name TEXT,
  p_role TEXT,
  p_store_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_auth_id UUID;
  v_clean_email TEXT;
  v_user_id TEXT;
BEGIN
  -- 1. Validação de permissão: apenas administradores
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem gerenciar usuários.';
  END IF;

  v_clean_email := lower(btrim(p_email));
  IF v_clean_email = '' OR p_name = '' THEN
    RAISE EXCEPTION 'Nome e e-mail são obrigatórios.';
  END IF;

  -- 2. Localiza auth_id existente no auth.users
  SELECT id INTO v_auth_id FROM auth.users WHERE lower(email) = v_clean_email LIMIT 1;

  IF v_auth_id IS NOT NULL THEN
    -- Atualiza dados de autenticação e senha (se fornecida)
    IF p_password IS NOT NULL AND btrim(p_password) <> '' THEN
      UPDATE auth.users
      SET encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
          raw_user_meta_data = jsonb_build_object('name', p_name, 'role', p_role, 'store_id', p_store_id),
          updated_at = now()
      WHERE id = v_auth_id;
    ELSE
      UPDATE auth.users
      SET raw_user_meta_data = jsonb_build_object('name', p_name, 'role', p_role, 'store_id', p_store_id),
          updated_at = now()
      WHERE id = v_auth_id;
    END IF;
  ELSE
    -- Se for novo usuário, a senha é obrigatória
    IF p_password IS NULL OR btrim(p_password) = '' THEN
      RAISE EXCEPTION 'A senha inicial é obrigatória para criar um novo usuário.';
    END IF;

    v_auth_id := gen_random_uuid();

    -- Inserção no auth.users
    INSERT INTO auth.users (
      instance_id,
      id,
      aud,
      role,
      email,
      encrypted_password,
      email_confirmed_at,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at,
      confirmation_token,
      recovery_token
    ) VALUES (
      '00000000-0000-0000-0000-000000000000',
      v_auth_id,
      'authenticated',
      'authenticated',
      v_clean_email,
      extensions.crypt(p_password, extensions.gen_salt('bf', 10)),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', p_name, 'role', p_role, 'store_id', p_store_id),
      now(),
      now(),
      '',
      ''
    );

    -- CRÍTICO: Inserção em auth.identities (sem isso o login por email nunca funciona)
    INSERT INTO auth.identities (
      id,
      user_id,
      identity_data,
      provider,
      provider_id,
      last_sign_in_at,
      created_at,
      updated_at
    ) VALUES (
      v_auth_id,
      v_auth_id,
      jsonb_build_object('sub', v_auth_id::text, 'email', v_clean_email),
      'email',
      v_auth_id::text,
      NULL,
      now(),
      now()
    );
  END IF;

  -- 3. Upsert no perfil público app_users
  v_user_id := COALESCE(NULLIF(p_id, ''), 'usr-' || substr(md5(random()::text), 1, 8));

  INSERT INTO public.app_users (id, auth_id, name, email, role, store_id)
  VALUES (
    v_user_id,
    v_auth_id,
    p_name,
    v_clean_email,
    p_role,
    NULLIF(p_store_id, '')
  )
  ON CONFLICT (email) DO UPDATE SET
    auth_id  = EXCLUDED.auth_id,
    name     = EXCLUDED.name,
    role     = EXCLUDED.role,
    store_id = EXCLUDED.store_id;

  RETURN jsonb_build_object('success', true, 'id', v_user_id, 'auth_id', v_auth_id);
END;
$$;

-- Função Segura para o Administrador excluir usuários
CREATE OR REPLACE FUNCTION public.admin_delete_user(p_user_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_auth_id UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Acesso negado: apenas administradores podem excluir usuários.';
  END IF;

  SELECT auth_id INTO v_auth_id FROM public.app_users WHERE id = p_user_id;

  DELETE FROM public.app_users WHERE id = p_user_id;

  IF v_auth_id IS NOT NULL THEN
    DELETE FROM auth.users WHERE id = v_auth_id;
  END IF;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- ====================================================================
-- POLÍTICAS DE SEGURANÇA (ROW LEVEL SECURITY - RLS)
-- ====================================================================

-- 1. Habilitar RLS em todas as tabelas
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.priorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

-- 2. Limpar políticas antigas
DROP POLICY IF EXISTS "Acesso publico stores" ON public.stores;
DROP POLICY IF EXISTS "Acesso publico categories" ON public.categories;
DROP POLICY IF EXISTS "Acesso publico statuses" ON public.statuses;
DROP POLICY IF EXISTS "Acesso publico priorities" ON public.priorities;
DROP POLICY IF EXISTS "Acesso publico app_users" ON public.app_users;
DROP POLICY IF EXISTS "Acesso publico tickets" ON public.tickets;
DROP POLICY IF EXISTS "Acesso publico alerts" ON public.alerts;

DROP POLICY IF EXISTS "Leitura stores autenticados" ON public.stores;
DROP POLICY IF EXISTS "Admin gerencia stores" ON public.stores;
DROP POLICY IF EXISTS "Leitura categories autenticados" ON public.categories;
DROP POLICY IF EXISTS "Admin gerencia categories" ON public.categories;
DROP POLICY IF EXISTS "Leitura statuses autenticados" ON public.statuses;
DROP POLICY IF EXISTS "Admin gerencia statuses" ON public.statuses;
DROP POLICY IF EXISTS "Leitura priorities autenticados" ON public.priorities;
DROP POLICY IF EXISTS "Admin gerencia priorities" ON public.priorities;
DROP POLICY IF EXISTS "Leitura app_users autenticados" ON public.app_users;
DROP POLICY IF EXISTS "Admin gerencia app_users" ON public.app_users;
DROP POLICY IF EXISTS "Tickets acesso por loja ou admin" ON public.tickets;
DROP POLICY IF EXISTS "Tickets criacao por autenticados" ON public.tickets;
DROP POLICY IF EXISTS "Tickets edicao por loja ou admin" ON public.tickets;
DROP POLICY IF EXISTS "Tickets delecao por admin" ON public.tickets;
DROP POLICY IF EXISTS "Alertas acesso por loja ou admin" ON public.alerts;
DROP POLICY IF EXISTS "Admin gerencia alerts" ON public.alerts;

-- 3. Políticas para Tabelas Base (stores, categories, statuses, priorities)
CREATE POLICY "Leitura stores autenticados" ON public.stores
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin gerencia stores" ON public.stores
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Leitura categories autenticados" ON public.categories
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin gerencia categories" ON public.categories
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Leitura statuses autenticados" ON public.statuses
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin gerencia statuses" ON public.statuses
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE POLICY "Leitura priorities autenticados" ON public.priorities
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin gerencia priorities" ON public.priorities
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 4. Políticas para Perfis de Usuários (app_users)
-- Usuários autenticados podem ver os perfis (sem senhas, que foram removidas da tabela)
CREATE POLICY "Leitura app_users autenticados" ON public.app_users
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admin gerencia app_users" ON public.app_users
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 5. Políticas para Demandas / O.S. (tickets)
CREATE POLICY "Tickets acesso por loja ou admin" ON public.tickets
  FOR SELECT TO authenticated
  USING (public.is_admin() OR store_id = public.get_user_store_id() OR store_id IS NULL);

CREATE POLICY "Tickets criacao por autenticados" ON public.tickets
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR store_id = public.get_user_store_id() OR store_id IS NULL);

CREATE POLICY "Tickets edicao por loja ou admin" ON public.tickets
  FOR UPDATE TO authenticated
  USING (public.is_admin() OR store_id = public.get_user_store_id() OR store_id IS NULL)
  WITH CHECK (public.is_admin() OR store_id = public.get_user_store_id() OR store_id IS NULL);

CREATE POLICY "Tickets delecao por admin" ON public.tickets
  FOR DELETE TO authenticated
  USING (public.is_admin());

-- 6. Políticas para Alertas Preventivos (alerts)
CREATE POLICY "Alertas acesso por loja ou admin" ON public.alerts
  FOR SELECT TO authenticated
  USING (public.is_admin() OR store_id = public.get_user_store_id() OR store_id IS NULL);

CREATE POLICY "Admin gerencia alerts" ON public.alerts
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ====================================================================
-- REALTIME
-- ====================================================================
DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.stores;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.categories;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.app_users;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.statuses;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.priorities;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
