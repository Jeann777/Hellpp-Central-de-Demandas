-- ====================================================================
-- SCRIPT DE RESTAURAÇÃO DE ACESSO ADMINISTRADOR: localclics.br@gmail.com
-- Executar no SQL Editor do Supabase (https://supabase.com/dashboard)
-- ====================================================================

-- 1. Certificar-se de que a extensão pgcrypto está ativa para criptografar a senha
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  v_email TEXT := 'localclics.br@gmail.com';
  -- DIGITE A SENHA DESEJADA ABAIXO (você pode alterar para a senha que preferir):
  v_password TEXT := 'Admin@123456'; 
  v_name TEXT := 'Administrador Master';
  v_auth_id UUID;
  v_user_id TEXT;
BEGIN
  v_email := lower(btrim(v_email));

  -- 2. Localizar ou criar o usuário em auth.users (Supabase Auth)
  SELECT id INTO v_auth_id FROM auth.users WHERE lower(email) = v_email LIMIT 1;

  IF v_auth_id IS NOT NULL THEN
    -- Usuário já existia no auth.users: atualiza a senha criptografada e confirma o e-mail
    UPDATE auth.users
    SET encrypted_password = crypt(v_password, gen_salt('bf')),
        email_confirmed_at = COALESCE(email_confirmed_at, now()),
        raw_user_meta_data = jsonb_build_object('name', v_name, 'role', 'admin', 'store_id', ''),
        raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
        updated_at = now()
    WHERE id = v_auth_id;
    RAISE NOTICE 'Senha e confirmação atualizadas para o usuário existente em auth.users (ID: %)', v_auth_id;
  ELSE
    -- Usuário não existia no auth.users: cria uma nova conta já confirmada
    v_auth_id := gen_random_uuid();
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
      v_email,
      crypt(v_password, gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('name', v_name, 'role', 'admin', 'store_id', ''),
      now(),
      now(),
      '',
      ''
    );
    RAISE NOTICE 'Novo usuário criado em auth.users (ID: %)', v_auth_id;
  END IF;

  -- 3. Localizar ou criar o perfil na tabela pública app_users como ADMIN
  SELECT id INTO v_user_id FROM public.app_users WHERE lower(email) = v_email LIMIT 1;

  IF v_user_id IS NULL THEN
    v_user_id := 'usr-admin-master';
    INSERT INTO public.app_users (id, auth_id, name, email, role, store_id, created_at)
    VALUES (v_user_id, v_auth_id, v_name, v_email, 'admin', NULL, now());
    RAISE NOTICE 'Perfil de administrador criado em public.app_users (ID: %)', v_user_id;
  ELSE
    UPDATE public.app_users
    SET auth_id = v_auth_id,
        name = v_name,
        role = 'admin',
        store_id = NULL
    WHERE id = v_user_id;
    RAISE NOTICE 'Perfil de administrador atualizado em public.app_users (ID: %)', v_user_id;
  END IF;

END $$;

-- 4. Verificação de integridade: conferir se o usuário está devidamente configurado
SELECT 
  u.id AS auth_id,
  u.email,
  u.email_confirmed_at,
  p.id AS app_user_id,
  p.name,
  p.role
FROM auth.users u
LEFT JOIN public.app_users p ON p.auth_id = u.id OR lower(p.email) = lower(u.email)
WHERE lower(u.email) = 'localclics.br@gmail.com';
