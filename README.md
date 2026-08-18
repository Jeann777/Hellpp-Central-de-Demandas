# Central de Demandas & O.S. (Lojas)

Sistema completo de gestão de demandas operacionais, manutenções e ordens de serviço para redes de lojas.

## 🚀 Tecnologias

- **Frontend:** React 18, Tailwind CSS, Lucide Icons, Vite
- **Backend & Database:** Supabase (PostgreSQL + Realtime Sync)
- **Hospedagem:** Vercel

## 📦 Como rodar localmente

1. Clone o repositório ou baixe os arquivos.
2. Instale as dependências:
   ```bash
   npm install
   ```
3. Crie um arquivo `.env` baseado no `.env.example` com suas credenciais do Supabase:
   ```env
   VITE_SUPABASE_URL=https://seu-projeto.supabase.co
   VITE_SUPABASE_ANON_KEY=sua-chave-anonima
   ```
4. Inicie o servidor local:
   ```bash
   npm run dev
   ```

## 🛠️ Banco de Dados

O script SQL de criação das tabelas e permissões em tempo real está localizado em `supabase/schema.sql`.
