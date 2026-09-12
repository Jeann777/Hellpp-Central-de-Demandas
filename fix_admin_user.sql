-- ====================================================================
-- SCRIPT DEFINITIVO: CRIAR/RESETAR USUÁRIO ADMINISTRADOR MASTER
-- Projeto: Hellpp — Central de Demandas
-- Executar no SQL Editor do Supabase: https://supabase.com/dashboard
-- ====================================================================
-- CORREÇÃO: inclui auth.identities (obrigatório para GoTrue/login email)
--           e usa extensions.crypt() (schema correto no Supabase Cloud)
-- ====================================================================

-- 1. Habilitar pgcrypto no schema extensions (padrão do Supabase Cloud)
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- 2. Remover completamente o usuário anterior para evitar conflitos de UUID
DO $$
DECLARE
  v_email TEXT := 'localclics.br@gmail.com';
BEGIN
  -- Remove identities vinculadas ao usuário
  DELETE FROM auth.identities
  WHERE user_id IN (
    SELECT id FROM auth.users WHERE lower(email) = v_email
  );

  -- Remove o usuário do auth.users
  DELETE FROM auth.users WHERE lower(email) = v_email;

  RAISE NOTICE 'Registros anteriores de % removidos com sucesso.', v_email;
END $$;

-- 3. Criar o usuário administrador master com senha e identity correta
DO $$
DECLARE
  v_user_id   UUID   := gen_random_uuid();
  v_email     TEXT   := 'localclics.br@gmail.com';
  v_password  TEXT   := 'Admin@123456';  -- Altere a senha aqui se quiser
  v_name      TEXT   := 'Administrador Master';
BEGIN
  v_email := lower(btrim(v_email));

  -- 3a. Inserir em auth.users com hash bcrypt via extensions.crypt()
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
    is_super_admin,
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
    now(),                                                                     -- email confirmado automaticamente
    '{"provider": "email", "providers": ["email"]}'::jsonb,
    jsonb_build_object('name', v_name, 'role', 'admin', 'store_id', ''),
    false,
    now(),
    now(),
    '',
    ''
  );

  -- 3b. Inserir em auth.identities (OBRIGATÓRIO para login email/senha no GoTrue)
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

  RAISE NOTICE 'Usuário criado em auth.users e auth.identities (ID: %)', v_user_id;

  -- 3c. Inserir ou atualizar o perfil público em public.app_users como ADMIN
  INSERT INTO public.app_users (id, auth_id, name, email, role, store_id, created_at)
  VALUES ('usr-admin-master', v_user_id, v_name, v_email, 'admin', NULL, now())
  ON CONFLICT (email) DO UPDATE
    SET auth_id  = EXCLUDED.auth_id,
        name     = EXCLUDED.name,
        role     = 'admin',
        store_id = NULL;

  RAISE NOTICE 'Perfil atualizado em public.app_users como admin.';
END $$;

-- 4. Verificação final — deve retornar 1 linha com role = admin e provider = email
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
