-- ====================================================================
-- SCHEMA DA CENTRAL DE DEMANDAS / O.S. (SUPABASE / POSTGRESQL)
-- ====================================================================

-- 1. Tabela de Lojas
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

-- 2. Tabela de Categorias
CREATE TABLE IF NOT EXISTS public.categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    icon TEXT DEFAULT '🔧',
    color TEXT DEFAULT '#0E6E5D',
    sla_hours INTEGER DEFAULT 48,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Tabela de Usuários / Perfis
CREATE TABLE IF NOT EXISTS public.app_users (
    id TEXT PRIMARY KEY,
    auth_id UUID,
    name TEXT NOT NULL,
    email TEXT,
    password TEXT DEFAULT '123456',
    role TEXT NOT NULL DEFAULT 'loja', -- 'admin' ou 'loja'
    store_id TEXT REFERENCES public.stores(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. Tabela de Status de O.S.
CREATE TABLE IF NOT EXISTS public.statuses (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    color TEXT NOT NULL,
    soft TEXT NOT NULL,
    closed BOOLEAN DEFAULT false,
    "order" INTEGER DEFAULT 1
);

-- 5. Tabela de Prioridades
CREATE TABLE IF NOT EXISTS public.priorities (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    color TEXT NOT NULL,
    soft TEXT NOT NULL,
    weight INTEGER DEFAULT 1
);

-- 6. Tabela de Demandas / O.S. (Tickets)
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

-- 7. Tabela de Alertas Preventivos
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
-- HABILITAR REALTIME (Para sincronização instantânea em todas as telas)
-- ====================================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.stores;
ALTER PUBLICATION supabase_realtime ADD TABLE public.categories;
ALTER PUBLICATION supabase_realtime ADD TABLE public.app_users;
ALTER PUBLICATION supabase_realtime ADD TABLE public.statuses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.priorities;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tickets;
ALTER PUBLICATION supabase_realtime ADD TABLE public.alerts;

-- ====================================================================
-- PERMISSÕES PÚBLICAS (RLS) PARA O MVP
-- ====================================================================
ALTER TABLE public.stores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.priorities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Acesso publico stores" ON public.stores FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso publico categories" ON public.categories FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso publico app_users" ON public.app_users FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso publico statuses" ON public.statuses FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso publico priorities" ON public.priorities FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso publico tickets" ON public.tickets FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Acesso publico alerts" ON public.alerts FOR ALL USING (true) WITH CHECK (true);

-- ====================================================================
-- SEED INICIAL (Dados Padrão de Status e Prioridades)
-- ====================================================================
INSERT INTO public.statuses (id, label, color, soft, closed, "order") VALUES
('aberta', 'Aberta', '#2255C9', '#E5EBFB', false, 1),
('andamento', 'Em andamento', '#B4650A', '#FBEEDF', false, 2),
('aguardando', 'Aguardando', '#6D28D9', '#EEE7FB', false, 3),
('aguardando_atesto', 'Aguardando atesto da loja', '#0E7A4A', '#E4F5EC', false, 4),
('nao_atestada', 'Não atestada', '#D0342C', '#FBE9E8', false, 5),
('concluida', 'Concluída', '#0E7A4A', '#E4F5EC', true, 6),
('cancelada', 'Cancelada', '#6B7280', '#EEF0F3', true, 7)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.priorities (id, label, color, soft, weight) VALUES
('urgente', 'Urgente', '#D0342C', '#FBE9E8', 4),
('alta', 'Alta', '#B4650A', '#FBEEDF', 3),
('media', 'Média', '#B08900', '#FBF3D9', 2),
('baixa', 'Baixa', '#6B7280', '#EEF0F3', 1)
ON CONFLICT (id) DO NOTHING;

-- Usuário Administrador Inicial (para primeiro acesso e gestão)
INSERT INTO public.app_users (id, name, email, password, role, store_id) VALUES
('usr-admin-master', 'Administrador', 'admin@empresa.com', 'admin', 'admin', NULL)
ON CONFLICT (id) DO NOTHING;

