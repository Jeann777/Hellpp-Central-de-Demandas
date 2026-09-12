-- ====================================================================
-- RESET TOTAL DO SISTEMA HELLPP
-- Executa no SQL Editor do Supabase: https://supabase.com/dashboard
-- ====================================================================
-- Este script LIMPA TODOS OS DADOS do sistema:
--   - Tickets (demandas)
--   - Alertas
--   - Usuários (auth + app_users)
-- E recria o administrador master.
-- As tabelas de configuração (stores, categories, statuses, priorities)
-- são PRESERVADAS com seus dados.
-- ====================================================================

-- 1. Habilitar pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Limpar TODOS os tickets e alertas
TRUNCATE public.tickets;
TRUNCATE public.alerts;

-- 3. Limpar TODOS os usuários (app_users + auth)
DELETE FROM public.app_users;
DELETE FROM auth.identities;
DELETE FROM auth.users;

-- 4. Recriar o administrador master
DO $$
DECLARE
  v_user_id   UUID   := gen_random_uuid();
  v_email     TEXT   := 'localclics.br@gmail.com';
  v_password  TEXT   := 'Admin@123456';  -- ⚠️ TROQUE ESTA SENHA APÓS O PRIMEIRO LOGIN
  v_name      TEXT   := 'Administrador Master';
BEGIN
  v_email := lower(btrim(v_email));

  -- 4a. Inserir em auth.users
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
    v_user_id,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(v_password, extensions.gen_salt('bf', 10)),
    now(),
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('name', v_name, 'role', 'admin', 'store_id', ''),
    now(),
    now(),
    '',
    ''
  );

  -- 4b. Inserir em auth.identities (OBRIGATÓRIO para login email/senha)
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
    v_user_id,
    v_user_id,
    jsonb_build_object(
      'sub',   v_user_id::text,
      'email', v_email
    ),
    'email',
    v_user_id::text,
    NULL,
    now(),
    now()
  );

  -- 4c. Inserir perfil em app_users como admin
  INSERT INTO public.app_users (id, auth_id, name, email, role, store_id, created_at)
  VALUES ('usr-admin-master', v_user_id, v_name, v_email, 'admin', NULL, now());

  RAISE NOTICE '✅ Admin master criado (ID: %). Email: %. Senha: Admin@123456', v_user_id, v_email;
END $$;

-- 5. Verificação final
SELECT
  u.id            AS auth_id,
  u.email,
  u.email_confirmed_at,
  i.provider,
  p.id            AS app_user_id,
  p.name,
  p.role
FROM auth.users u
JOIN  auth.identities i ON i.user_id = u.id
LEFT JOIN public.app_users p
  ON p.auth_id = u.id OR lower(p.email) = lower(u.email)
WHERE lower(u.email) = 'localclics.br@gmail.com';

-- ====================================================================
-- RESULTADO ESPERADO: 1 linha com role = admin e provider = email
-- ====================================================================
-- Credenciais pós-reset:
--   📧 Email: localclics.br@gmail.com
--   🔑 Senha: Admin@123456
-- ⚠️ TROQUE A SENHA IMEDIATAMENTE PELO PAINEL DO SISTEMA
-- ====================================================================
