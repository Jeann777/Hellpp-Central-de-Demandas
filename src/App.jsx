import React, { useEffect, useMemo, useState } from "react";
import {
  LayoutGrid, ClipboardList, Bell, Building2, Tag, Users, Plus, Search,
  X, Paperclip, Trash2, Pencil, Check, AlertTriangle,
  CalendarClock, MessageSquare, Loader2, Shield, Flag, SlidersHorizontal, BarChart3, Download, Info,
  Cloud, RefreshCw, LogOut, Lock, Mail, Eye, EyeOff, KeyRound, UserCheck
} from "lucide-react";
import {
  isSupabaseConfigured,
  loadSupabaseData,
  syncKeyToSupabase,
  seedSupabaseIfEmpty,
  subscribeToSupabase
} from "./lib/supabaseSync.js";

/* ------------------------------------------------------------------ */
/* Tokens & constants                                                  */
/* ------------------------------------------------------------------ */

const TOKENS = `
  :root{
    --bg:#F3F4F7;
    --surface:#FFFFFF;
    --ink:#161B26;
    --muted:#6B7280;
    --faint:#9CA3AF;
    --border:#E4E6EB;
    --accent:#0E6E5D;
    --accent-ink:#0B584A;
    --accent-soft:#E4F2EF;
    --danger:#D0342C;
    --danger-soft:#FBE9E8;
    --warn:#B4650A;
    --warn-soft:#FBEEDF;
    --ok:#0E7A4A;
    --ok-soft:#E4F5EC;
    --font-ui: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --font-mono: 'IBM Plex Mono', 'SFMono-Regular', Menlo, monospace;
  }
`;

const DATA_KEY = "od_app_data_v2";
const CURRENT_USER_KEY = "od_current_user_id";
const LAST_LOGIN_KEY = "od_last_login_map";

const DEFAULT_STATUSES = [
  { id: "aberta", label: "Aberta", color: "#2255C9", soft: "#E5EBFB", closed: false, order: 1 },
  { id: "andamento", label: "Em andamento", color: "#B4650A", soft: "#FBEEDF", closed: false, order: 2 },
  { id: "aguardando", label: "Aguardando", color: "#6D28D9", soft: "#EEE7FB", closed: false, order: 3 },
  { id: "aguardando_atesto", label: "Aguardando atesto da loja", color: "#0E7A4A", soft: "#E4F5EC", closed: false, order: 4 },
  { id: "nao_atestada", label: "Não atestada", color: "#D0342C", soft: "#FBE9E8", closed: false, order: 5 },
  { id: "concluida", label: "Concluída", color: "#0E7A4A", soft: "#E4F5EC", closed: true, order: 6 },
  { id: "cancelada", label: "Cancelada", color: "#6B7280", soft: "#EEF0F3", closed: true, order: 7 },
];
const DEFAULT_PRIORITIES = [
  { id: "urgente", label: "Urgente", color: "#D0342C", soft: "#FBE9E8", weight: 4 },
  { id: "alta", label: "Alta", color: "#B4650A", soft: "#FBEEDF", weight: 3 },
  { id: "media", label: "Média", color: "#B08900", soft: "#FBF3D9", weight: 2 },
  { id: "baixa", label: "Baixa", color: "#6B7280", soft: "#EEF0F3", weight: 1 },
];

const RECURRENCES = [
  { id: "none", label: "Não repete" },
  { id: "mensal", label: "Mensal" },
  { id: "trimestral", label: "Trimestral" },
  { id: "semestral", label: "Semestral" },
  { id: "anual", label: "Anual" },
];

const ROLES = [
  { id: "admin", label: "Administrador" },
  { id: "loja", label: "Usuário Loja" },
];

// IDs de status que fazem parte do fluxo de atesto e não são escolhidos manualmente pelo administrador.
const ATTEST_FLOW_STATUS_IDS = ["concluida", "aguardando_atesto"];

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function findStatus(data, id) { return (data.statuses || []).find(s => s.id === id) || { id, label: id || "—", color: "var(--muted)", soft: "#EEF0F3" }; }
function findPriority(data, id) { return (data.priorities || []).find(p => p.id === id) || { id, label: id || "—", color: "var(--muted)", soft: "#EEF0F3" }; }
function isClosedStatus(data, id) { const s = (data.statuses || []).find(x => x.id === id); return s ? !!s.closed : false; }
function sortedStatuses(data) { return [...(data.statuses || [])].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)); }
function sortedPriorities(data) { return [...(data.priorities || [])].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0)); }
function topPriority(data) { if (!data.priorities || data.priorities.length === 0) return null; return data.priorities.reduce((a, b) => (b.weight ?? 0) > (a.weight ?? 0) ? b : a); }
function lighten(hex, amount = 0.85) {
  const h = (hex || "#999999").replace("#", "");
  const full = h.length === 3 ? h.split("").map(c => c + c).join("") : h;
  const r = parseInt(full.substring(0, 2), 16) || 0, g = parseInt(full.substring(2, 4), 16) || 0, b = parseInt(full.substring(4, 6), 16) || 0;
  const mix = c => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function uid() { return Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4); }
// Compatibilidade: converte usuários salvos em versões antigas para o novo modelo com senha.
function normalizeUser(u) {
  let role = u.role === "admin" ? "admin" : "loja";
  let storeId = u.storeId || (Array.isArray(u.storeIds) && u.storeIds.length ? u.storeIds[0] : "") || "";
  let password = u.password || (role === "admin" ? "admin" : "123");
  const { storeIds, ...rest } = u;
  return { ...rest, role, storeId, password };
}
function csvEscape(val) { return `"${(val ?? "").toString().replace(/"/g, '""')}"`; }
function downloadCSV(filename, headers, rows) {
  const lines = [headers.map(csvEscape).join(";"), ...rows.map(r => r.map(csvEscape).join(";"))];
  const csv = "\uFEFF" + lines.join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
function cx(...a) { return a.filter(Boolean).join(" "); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function fmtDate(d) { if (!d) return "—"; const dt = new Date(d + "T00:00:00"); if (isNaN(dt)) return "—"; return dt.toLocaleDateString("pt-BR"); }
function fmtDateTime(d) { const dt = new Date(d); return dt.toLocaleDateString("pt-BR") + " " + dt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); }
function daysDiff(dateStr) {
  if (!dateStr) return null;
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + "T00:00:00");
  return Math.round((d - t) / 86400000);
}
function addRecurrence(dateStr, rec) {
  const d = new Date(dateStr + "T00:00:00");
  if (rec === "mensal") d.setMonth(d.getMonth() + 1);
  else if (rec === "trimestral") d.setMonth(d.getMonth() + 3);
  else if (rec === "semestral") d.setMonth(d.getMonth() + 6);
  else if (rec === "anual") d.setFullYear(d.getFullYear() + 1);
  else return null;
  return d.toISOString().slice(0, 10);
}
function calcDueDate(slaHours, fromISODate) {
  const base = fromISODate ? new Date(fromISODate) : new Date();
  const days = Math.max(1, Math.ceil((Number(slaHours) || 48) / 24));
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function nextSeq(tickets) {
  const year = new Date().getFullYear();
  const max = tickets.filter(t => t.year === year).reduce((m, t) => Math.max(m, t.seq || 0), 0);
  return { year, seq: max + 1 };
}
function osCode(t) { return `OS-${t.year}-${String(t.seq).padStart(4, "0")}`; }
function addDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }

/* ------------------------------------------------------------------ */
/* Seed data                                                           */
/* ------------------------------------------------------------------ */

function seedData() {
  const stores = [
    { id: uid(), name: "Loja Shopping Bosque", code: "SBQ", city: "Campo Grande", uf: "MS", address: "Av. Afonso Pena, 4909", active: true },
    { id: uid(), name: "Loja Centro", code: "CTR", city: "Campo Grande", uf: "MS", address: "Rua 14 de Julho, 1200", active: true },
    { id: uid(), name: "Loja Água Verde", code: "AGV", city: "Dourados", uf: "MS", address: "Av. Marcelino Pires, 850", active: true },
  ];
  const categories = [
    { id: uid(), name: "Manutenção predial", icon: "🔧", color: "#0E6E5D", slaHours: 48 },
    { id: uid(), name: "Informática / TI", icon: "💻", color: "#2255C9", slaHours: 24 },
    { id: uid(), name: "Suprimentos", icon: "📦", color: "#B08900", slaHours: 72 },
    { id: uid(), name: "Elétrica", icon: "⚡", color: "#B4650A", slaHours: 24 },
    { id: uid(), name: "Hidráulica", icon: "🚿", color: "#2C7BB5", slaHours: 48 },
    { id: uid(), name: "Segurança / Incêndio", icon: "🧯", color: "#D0342C", slaHours: 12 },
  ];
  const users = [
    { id: uid(), name: "Renata Souza (Admin)", email: "admin@empresa.com", password: "admin", role: "admin", storeId: "" },
    { id: uid(), name: "Carlos Mendes", email: "loja1@empresa.com", password: "123", role: "loja", storeId: stores[0].id },
    { id: uid(), name: "Fabiana Lima", email: "loja2@empresa.com", password: "123", role: "loja", storeId: stores[1].id },
    { id: uid(), name: "João Prado", email: "loja3@empresa.com", password: "123", role: "loja", storeId: stores[2].id },
  ];
  const year = new Date().getFullYear();
  const mk = (over) => ({ attachments: [], comments: [], history: [], budget: "", serviceNotes: "", updatedAt: over.createdAt, attestedBy: "", attestedAt: "", ...over });
  const tickets = [
    mk({ id: uid(), year, seq: 1, title: "Ar-condicionado sem gelar no depósito", description: "Unidade split do depósito parou de gelar, provável falta de gás.", categoryId: categories[0].id, storeId: stores[0].id, priority: "alta", status: "andamento", requesterId: users[1].id, assigneeId: users[0].id, createdAt: new Date(Date.now() - 86400000 * 3).toISOString(), dueDate: addDays(2), comments: [{ id: uid(), author: "Carlos Mendes", text: "Técnico já foi acionado, aguardando visita.", createdAt: new Date(Date.now() - 86400000).toISOString(), attachments: [] }] }),
    mk({ id: uid(), year, seq: 2, title: "PDV 3 travando ao emitir cupom fiscal", description: "Sistema do PDV trava e reinicia sozinho ao finalizar venda.", categoryId: categories[1].id, storeId: stores[1].id, priority: "urgente", status: "aberta", requesterId: users[2].id, assigneeId: users[0].id, createdAt: new Date(Date.now() - 86400000).toISOString(), dueDate: addDays(0) }),
    mk({ id: uid(), year, seq: 3, title: "Reposição de sacolas plásticas", description: "Estoque de sacolas para o caixa está acabando.", categoryId: categories[2].id, storeId: stores[0].id, priority: "media", status: "aberta", requesterId: users[1].id, assigneeId: "", createdAt: new Date(Date.now() - 86400000 * 2).toISOString(), dueDate: addDays(5) }),
    mk({ id: uid(), year, seq: 4, title: "Lâmpadas queimadas na vitrine", description: "3 lâmpadas de LED da vitrine frontal queimadas.", categoryId: categories[3].id, storeId: stores[2].id, priority: "baixa", status: "concluida", requesterId: users[3].id, assigneeId: users[0].id, createdAt: new Date(Date.now() - 86400000 * 10).toISOString(), dueDate: addDays(-5) }),
    mk({ id: uid(), year, seq: 5, title: "Vazamento no banheiro dos funcionários", description: "Registro do vaso sanitário com vazamento constante.", categoryId: categories[4].id, storeId: stores[1].id, priority: "alta", status: "aguardando", requesterId: users[2].id, assigneeId: users[0].id, createdAt: new Date(Date.now() - 86400000 * 4).toISOString(), dueDate: addDays(1) }),
    mk({ id: uid(), year, seq: 6, title: "Troca do extintor de incêndio - validade vencendo", description: "Extintor da área de estoque com validade próxima do vencimento.", categoryId: categories[5].id, storeId: stores[0].id, priority: "media", status: "concluida", requesterId: users[1].id, assigneeId: users[0].id, createdAt: new Date(Date.now() - 86400000 * 20).toISOString(), dueDate: addDays(-15) }),
  ];
  const alerts = [
    { id: uid(), title: "Recarga do extintor de incêndio", storeId: stores[0].id, categoryId: categories[5].id, dueDate: addDays(340), recurrence: "anual", status: "ativo", notes: "Extintor trocado/recarregado — renovar antes do vencimento.", createdAt: new Date().toISOString(), linkedTicketId: tickets[5].id },
    { id: uid(), title: "Manutenção preventiva dos ares-condicionados", storeId: stores[1].id, categoryId: categories[0].id, dueDate: addDays(25), recurrence: "trimestral", status: "ativo", notes: "Limpeza de filtros e checagem de gás.", createdAt: new Date().toISOString(), linkedTicketId: "" },
    { id: uid(), title: "Renovação do contrato de licença do sistema de PDV", storeId: stores[2].id, categoryId: categories[1].id, dueDate: addDays(-3), recurrence: "anual", status: "ativo", notes: "", createdAt: new Date().toISOString(), linkedTicketId: "" },
  ];
  return { stores, categories, users, tickets, alerts, statuses: DEFAULT_STATUSES.map(s => ({ ...s })), priorities: DEFAULT_PRIORITIES.map(p => ({ ...p })) };
}

/* ------------------------------------------------------------------ */
/* Small UI atoms                                                      */
/* ------------------------------------------------------------------ */

function Pill({ label, color, soft }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium whitespace-nowrap" style={{ backgroundColor: soft, color }}>
      {label}
    </span>
  );
}
function IconBtn({ onClick, title, children }) {
  return <button onClick={onClick} title={title} className="p-1.5 rounded hover:opacity-70 transition" style={{ color: "var(--muted)" }}>{children}</button>;
}
function Button({ children, onClick, variant = "solid", size = "md", type = "button", className = "", disabled }) {
  const base = "inline-flex items-center gap-1.5 rounded-md font-medium transition select-none";
  const sizes = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm";
  const styles = {
    solid: { backgroundColor: "var(--accent)", color: "#fff", opacity: disabled ? 0.5 : 1 },
    outline: { backgroundColor: "transparent", color: "var(--ink)", border: "1px solid var(--border)" },
    ghost: { backgroundColor: "transparent", color: "var(--muted)" },
    danger: { backgroundColor: "var(--danger-soft)", color: "var(--danger)" },
  }[variant];
  return <button type={type} onClick={onClick} disabled={disabled} className={cx(base, sizes, className)} style={styles}>{children}</button>;
}
function Field({ label, children, hint }) {
  return (
    <label className="block">
      <span className="block text-xs font-semibold mb-1" style={{ color: "var(--muted)" }}>{label}</span>
      {children}
      {hint && <span className="block text-xs mt-1" style={{ color: "var(--faint)" }}>{hint}</span>}
    </label>
  );
}
const inputStyle = { width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", backgroundColor: "#fff", color: "var(--ink)", fontSize: 14, fontFamily: "var(--font-ui)" };
function TextInput(props) { return <input {...props} style={{ ...inputStyle, ...(props.style || {}) }} />; }
function TextArea(props) { return <textarea {...props} style={{ ...inputStyle, resize: "vertical", ...(props.style || {}) }} />; }
function Select({ children, ...props }) { return <select {...props} style={{ ...inputStyle }}>{children}</select>; }

function Modal({ title, onClose, children, footer, width = 560 }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto py-8 px-4" style={{ backgroundColor: "rgba(15,20,30,0.45)" }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="w-full rounded-xl shadow-xl" style={{ maxWidth: width, backgroundColor: "var(--surface)" }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid var(--border)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{title}</h3>
          <button onClick={onClose}><X size={18} color="var(--muted)" /></button>
        </div>
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-3 flex justify-end gap-2" style={{ borderTop: "1px solid var(--border)" }}>{footer}</div>}
      </div>
    </div>
  );
}
function EmptyState({ icon, title, sub }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-16 gap-2">
      <div style={{ color: "var(--faint)" }}>{icon}</div>
      <p className="text-sm font-medium" style={{ color: "var(--ink)" }}>{title}</p>
      <p className="text-xs" style={{ color: "var(--faint)" }}>{sub}</p>
    </div>
  );
}
function Bar({ label, value, max, color, onClick }) {
  const pct = max ? Math.max(4, Math.round((value / max) * 100)) : 4;
  const content = (
    <>
      <span className="text-xs w-32 shrink-0 truncate" style={{ color: "var(--ink)" }}>{label}</span>
      <div className="flex-1 h-2 rounded-full" style={{ backgroundColor: "#EEF0F3" }}>
        <div className="h-2 rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-xs w-5 text-right font-semibold" style={{ color: "var(--muted)", fontFamily: "var(--font-mono)" }}>{value}</span>
    </>
  );
  if (onClick) {
    return <button type="button" onClick={onClick} className="flex items-center gap-2 mb-2.5 w-full text-left hover:opacity-70 transition">{content}</button>;
  }
  return <div className="flex items-center gap-2 mb-2.5">{content}</div>;
}
function PanelBar({ title, items, max, empty, onItemClick }) {
  return (
    <div className="rounded-xl p-5" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}>
      <p className="text-sm font-semibold mb-3" style={{ color: "var(--ink)" }}>{title}</p>
      {items.every(i => i.value === 0) ? <p className="text-xs" style={{ color: "var(--faint)" }}>{empty}</p> :
        items.map(i => <Bar key={i.id || i.label} label={i.label} value={i.value} max={max} color={i.color} onClick={onItemClick && i.value > 0 ? () => onItemClick(i) : undefined} />)}
    </div>
  );
}
function KpiCard({ label, value, tone, onClick }) {
  const Comp = onClick ? "button" : "div";
  return (
    <Comp type={onClick ? "button" : undefined} onClick={onClick} className="rounded-xl p-4 flex-1 text-left"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", minWidth: 150, cursor: onClick ? "pointer" : "default" }}>
      <p className="text-xs font-medium" style={{ color: "var(--muted)" }}>{label}</p>
      <p className="text-2xl font-bold mt-1" style={{ color: tone || "var(--ink)", fontFamily: "var(--font-mono)" }}>{value}</p>
    </Comp>
  );
}

/* ------------------------------------------------------------------ */
/* Storage hook                                                        */
/* ------------------------------------------------------------------ */

const EMPTY_DATA = { stores: [], categories: [], users: [], tickets: [], alerts: [], statuses: [], priorities: [] };

function useStore() {
  const [data, setData] = useState(EMPTY_DATA);
  const [ready, setReady] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const settledRef = React.useRef(false);

  // Rede de segurança: se por qualquer motivo demorar mais de 8s, libera com seedData
  useEffect(() => {
    const t = setTimeout(() => {
      if (!settledRef.current) {
        settledRef.current = true;
        setData(seedData());
        setReady(true);
      }
    }, 8000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // 1. Tenta carregar do Supabase se configurado
      if (isSupabaseConfigured) {
        try {
          const supabaseData = await loadSupabaseData();
          if (!cancelled && supabaseData) {
            let loadedData = { ...supabaseData };
            
            // Se a tabela de usuários estiver vazia no banco, garante o Administrador inicial
            if (!loadedData.users || loadedData.users.length === 0) {
              const defaultAdmin = {
                id: "usr-admin-master",
                name: "Administrador",
                email: "admin@empresa.com",
                password: "admin",
                role: "admin",
                storeId: ""
              };
              loadedData.users = [defaultAdmin];
              syncKeyToSupabase('users', [defaultAdmin]).catch(() => {});
            }

            if (!cancelled) {
              settledRef.current = true;
              setData(loadedData);
              setReady(true);
            }
            return;
          }
        } catch (err) {
          console.error("Erro ao carregar do Supabase:", err);
        }
      }

      if (cancelled) return;

      // 2. Fallback para storage local
      let parsed = null;
      try {
        const r = await window.storage?.get(DATA_KEY, true);
        parsed = r ? JSON.parse(r.value) : null;
      } catch { parsed = null; }

      if (cancelled) return;

      if (!parsed) {
        const seed = seedData();
        try { await window.storage?.set(DATA_KEY, JSON.stringify(seed), true); } catch { if (!cancelled) setSaveError(true); }
        if (!cancelled) { settledRef.current = true; setData(seed); setReady(true); }
        return;
      }

      const savedStatuses = parsed.statuses && parsed.statuses.length ? parsed.statuses : DEFAULT_STATUSES.map(s => ({ ...s }));
      const missingStatuses = DEFAULT_STATUSES.filter(ds => !savedStatuses.some(s => s.id === ds.id));
      const mergedStatuses = [...savedStatuses, ...missingStatuses.map(s => ({ ...s }))];
      const merged = {
        stores: parsed.stores || [],
        categories: parsed.categories || [],
        users: (parsed.users || []).map(normalizeUser),
        tickets: (parsed.tickets || []).map(t => ({ budget: "", serviceNotes: "", updatedAt: t.createdAt, attestedBy: "", attestedAt: "", ...t })),
        alerts: parsed.alerts || [],
        statuses: mergedStatuses,
        priorities: parsed.priorities && parsed.priorities.length ? parsed.priorities : DEFAULT_PRIORITIES.map(p => ({ ...p })),
      };

      if (!cancelled) { settledRef.current = true; setData(merged); setReady(true); }
    })();

    return () => { cancelled = true; };
  }, []);

  // 3. Inicia escuta Realtime do Supabase
  useEffect(() => {
    if (!ready || !isSupabaseConfigured) return;

    const unsubscribe = subscribeToSupabase(async () => {
      setIsSyncing(true);
      const fresh = await loadSupabaseData();
      if (fresh) {
        setData(prev => ({
          stores: fresh.stores?.length ? fresh.stores : prev.stores,
          categories: fresh.categories?.length ? fresh.categories : prev.categories,
          users: fresh.users?.length ? fresh.users : prev.users,
          tickets: fresh.tickets || prev.tickets,
          alerts: fresh.alerts || prev.alerts,
          statuses: fresh.statuses?.length ? fresh.statuses : prev.statuses,
          priorities: fresh.priorities?.length ? fresh.priorities : prev.priorities,
        }));
      }
      setTimeout(() => setIsSyncing(false), 600);
    });

    return () => {
      unsubscribe();
    };
  }, [ready]);

  function update(key, value) {
    setData(prev => {
      const next = { ...prev, [key]: value };
      
      // Sincroniza com Supabase em segundo plano
      if (isSupabaseConfigured) {
        syncKeyToSupabase(key, value).catch(err => {
          console.error(`Erro ao sincronizar ${key} com Supabase:`, err);
          setSaveError(true);
        });
      }

      // Mantém espelho no localStorage
      try {
        window.storage?.set(DATA_KEY, JSON.stringify(next), true)?.catch(() => setSaveError(true));
      } catch {}

      return next;
    });
  }

  return { data, ready, update, saveError, isSyncing, isCloud: isSupabaseConfigured };
}

/* ------------------------------------------------------------------ */
/* Tela de Login                                                       */
/* ------------------------------------------------------------------ */

function LoginScreen({ users, stores, onLogin, isCloud }) {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function handleSubmit(e) {
    e.preventDefault();
    setError("");
    const cleanId = identifier.trim().toLowerCase();
    const cleanPass = password.trim();

    if (!cleanId) {
      setError("Por favor, informe seu e-mail ou nome de usuário.");
      return;
    }
    if (!cleanPass) {
      setError("Por favor, digite sua senha de acesso.");
      return;
    }

    setLoading(true);
    setTimeout(() => {
      // Procura por email (case-insensitive) ou nome
      const user = users.find(u =>
        (u.email && u.email.trim().toLowerCase() === cleanId) ||
        (u.name && u.name.trim().toLowerCase() === cleanId)
      );

      if (!user) {
        // Se ainda não houver usuários cadastrados no banco, autentica e provisiona o Administrador
        if (users.length === 0 || ((cleanId === "admin@empresa.com" || cleanId === "admin") && cleanPass === "admin")) {
          const adminUser = {
            id: "usr-admin-master",
            name: "Administrador",
            email: "admin@empresa.com",
            password: "admin",
            role: "admin",
            storeId: ""
          };
          syncKeyToSupabase('users', [adminUser]).catch(() => {});
          onLogin(adminUser);
          return;
        }

        setError("Usuário não encontrado. Verifique o e-mail digitado.");
        setLoading(false);
        return;
      }

      const validPassword = user.password || (user.role === "admin" ? "admin" : "123");
      if (cleanPass === validPassword) {
        onLogin(user);
      } else {
        setError("Senha incorreta. Tente novamente.");
        setLoading(false);
      }
    }, 150);
  }

  function handleDemoLogin(u) {
    setIdentifier(u.email || u.name);
    setPassword("");
    setError("");
  }

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-4" style={{ backgroundColor: "#0F141E", fontFamily: "var(--font-ui)" }}>
      <div className="w-full max-w-md rounded-2xl p-8 shadow-2xl" style={{ backgroundColor: "#181F2C", border: "1px solid #2B3445" }}>
        
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="text-4xl font-extrabold tracking-tight" style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>Hellpp</span>
          </div>
          <h2 className="text-lg font-bold text-white mb-1">Central de Demandas</h2>
          <p className="text-xs" style={{ color: "#8A93A6" }}>Informe seu e-mail e senha para acessar o sistema</p>
        </div>

        {/* Error alert */}
        {error && (
          <div className="mb-5 p-3 rounded-lg flex items-center gap-2.5 text-xs font-medium text-red-300" style={{ backgroundColor: "rgba(208,52,44,0.15)", border: "1px solid rgba(208,52,44,0.4)" }}>
            <AlertTriangle size={16} className="shrink-0 text-red-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1.5">E-mail ou Usuário</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <Mail size={16} />
              </span>
              <input
                type="text"
                value={identifier}
                onChange={e => setIdentifier(e.target.value)}
                placeholder="ex: seu-email@empresa.com"
                className="w-full pl-9 pr-3 py-2.5 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                style={{ backgroundColor: "#101622", border: "1px solid #2B3445" }}
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-300 mb-1.5">Senha de Acesso</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
                <Lock size={16} />
              </span>
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Digite sua senha"
                className="w-full pl-9 pr-10 py-2.5 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition"
                style={{ backgroundColor: "#101622", border: "1px solid #2B3445" }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full mt-2 py-3 rounded-lg text-sm font-semibold text-white transition flex items-center justify-center gap-2 shadow-lg"
            style={{ backgroundColor: "var(--accent)", opacity: loading ? 0.7 : 1 }}
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <KeyRound size={16} />}
            {loading ? "Entrando..." : "Entrar no Sistema"}
          </button>
        </form>

        {/* Quick access helper */}
        {users && users.length > 0 && (
          <div className="mt-8 pt-6" style={{ borderTop: "1px solid #2B3445" }}>
            <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide text-center mb-3">
              Acessos Rápidos:
            </p>
            <div className="flex flex-col gap-1.5">
              {users.slice(0, 4).map(u => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => handleDemoLogin(u)}
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-xs transition text-left hover:bg-emerald-950/30"
                  style={{ backgroundColor: "#101622", border: "1px solid #2B3445", color: "#CBD5E1" }}
                  title="Clique para selecionar este usuário"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-semibold text-white">{u.name}</span>
                    <span className="text-[10px] text-gray-400">({u.email})</span>
                  </div>
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: u.role === 'admin' ? 'rgba(14,110,93,0.3)' : 'rgba(34,85,201,0.2)', color: u.role === 'admin' ? '#34D399' : '#93C5FD' }}>
                    {u.role === 'admin' ? 'Admin' : 'Loja'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function useCurrentUser(ready, users) {
  const [session, setSession] = useState(() => {
    try {
      const stored = localStorage.getItem(CURRENT_USER_KEY);
      if (!stored) return null;
      if (stored.startsWith('{')) {
        return JSON.parse(stored);
      }
      return { id: stored };
    } catch { return null; }
  });

  function loginUser(user) {
    const userObj = typeof user === 'object' ? user : { id: user };
    setSession(userObj);
    try {
      localStorage.setItem(CURRENT_USER_KEY, JSON.stringify(userObj));
      window.storage?.set(CURRENT_USER_KEY, JSON.stringify(userObj), false)?.catch(() => {});
    } catch {}
  }

  function logoutUser() {
    setSession(null);
    try {
      localStorage.removeItem(CURRENT_USER_KEY);
      window.storage?.delete?.(CURRENT_USER_KEY)?.catch(() => {});
    } catch {}
  }

  // Mantém o usuário atual ativo, mesclando atualizações do banco sem nunca derrubar a sessão
  const currentUser = useMemo(() => {
    if (!session) return null;
    const found = users?.find(u => u.id === session.id || (u.email && session.email && u.email.toLowerCase() === session.email.toLowerCase()));
    if (found) return found;
    return session;
  }, [users, session]);

  return { currentUser, loginUser, logoutUser };
}

/* ------------------------------------------------------------------ */
/* Sidebar                                                              */
/* ------------------------------------------------------------------ */

function Sidebar({ view, setView, counts, currentUser, stores, onLogout }) {
  const isAdmin = currentUser?.role === "admin";
  const userStore = stores?.find(s => s.id === currentUser?.storeId);
  const items = [
    { id: "dashboard", label: "Painel", icon: LayoutGrid },
    { id: "tickets", label: "Demandas", icon: ClipboardList, badge: counts.open },
    { id: "alerts", label: "Alertas", icon: Bell, badge: counts.alerts },
  ];
  if (isAdmin) items.push({ id: "reports", label: "Relatórios", icon: BarChart3 });
  if (isAdmin) items.push({ id: "admin", label: "Administração", icon: Shield });

  return (
    <div className="w-60 shrink-0 h-screen flex flex-col justify-between" style={{ backgroundColor: "var(--ink)" }}>
      <div>
        <div className="px-5 pt-6 pb-5">
          <div className="flex items-baseline gap-1">
            <span className="text-xl font-extrabold tracking-tight" style={{ color: "var(--accent)", fontFamily: "var(--font-mono)" }}>Hellpp</span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: "#8A93A6" }}>
            {isAdmin ? "Central Administrativa Geral" : (userStore?.name || "Painel da Loja")}
          </p>
        </div>
        <nav className="px-3 flex flex-col gap-0.5">
          {items.map(it => {
            const Icon = it.icon;
            const active = view === it.id;
            return (
              <button key={it.id} onClick={() => setView(it.id)}
                className="flex items-center justify-between px-3 py-2 rounded-md text-sm transition"
                style={{ backgroundColor: active ? "rgba(14,110,93,0.25)" : "transparent", color: active ? "#fff" : "#B7BECC", borderLeft: active ? "2px solid var(--accent)" : "2px solid transparent" }}>
                <span className="flex items-center gap-2.5"><Icon size={16} />{it.label}</span>
                {!!it.badge && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ backgroundColor: active ? "var(--accent)" : "#2B3242", color: "#fff" }}>{it.badge}</span>}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="px-4 py-4" style={{ borderTop: "1px solid #262E3D" }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#6B7383" }}>Conectado como</span>
          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: isSupabaseConfigured ? "rgba(14,122,74,0.2)" : "#222A38", color: isSupabaseConfigured ? "#34D399" : "#9CA3AF" }}>
            <span className={`w-1.5 h-1.5 rounded-full ${isSupabaseConfigured ? 'bg-emerald-400 animate-pulse' : 'bg-gray-400'}`} />
            {isSupabaseConfigured ? "Nuvem Ativa" : "Local"}
          </span>
        </div>

        <div className="rounded-lg p-2.5 mb-2.5 flex items-center gap-2.5" style={{ backgroundColor: "#1F2532", border: "1px solid #2B3242" }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ backgroundColor: "var(--accent)", color: "#fff" }}>
            {currentUser?.name?.split(" ").map(n => n[0]).slice(0, 2).join("") || "U"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate">{currentUser?.name}</p>
            <p className="text-[11px] truncate" style={{ color: "#8A93A6" }}>
              {currentUser?.role === "admin" ? "Administrador" : (userStore?.name || "Loja")}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-1.5 text-xs rounded-md py-1.5 font-medium transition cursor-pointer"
          style={{ backgroundColor: "rgba(208,52,44,0.12)", color: "#F87171", border: "1px solid rgba(208,52,44,0.3)" }}
          title="Sair da conta e voltar ao login"
        >
          <LogOut size={13} /> Sair do sistema
        </button>
      </div>
    </div>
  );
}


/* ------------------------------------------------------------------ */
/* Dashboard                                                            */
/* ------------------------------------------------------------------ */

function Dashboard({ data, currentUser, sinceLogin, onGoTickets, onGoAlerts }) {
  const isAdmin = currentUser?.role === "admin";
  const myStoreId = !isAdmin ? (currentUser?.storeId || "") : "";
  const [storeFilter, setStoreFilter] = useState(myStoreId);
  const scoped = data.tickets.filter(t => !storeFilter || t.storeId === storeFilter);
  const openTickets = scoped.filter(t => !isClosedStatus(data, t.status));
  const overdue = openTickets.filter(t => t.dueDate && daysDiff(t.dueDate) < 0);
  const onTime = openTickets.filter(t => !t.dueDate || daysDiff(t.dueDate) >= 0);
  const top = topPriority(data);
  const topOpen = top ? openTickets.filter(t => t.priority === top.id).length : 0;
  const alertsScoped = data.alerts.filter(a => a.status === "ativo" && (!storeFilter || a.storeId === storeFilter));
  const upcomingAlerts = alertsScoped.filter(a => daysDiff(a.dueDate) <= 30).sort((a, b) => daysDiff(a.dueDate) - daysDiff(b.dueDate));

  // Indicador de itens atestados pela "outra ponta" (loja avisa admin, admin avisa loja) desde o último acesso.
  const attestCutoff = sinceLogin || addDays(-7);
  const attestedByOther = isAdmin
    ? scoped.filter(t => t.attestedBy === "loja" && t.updatedAt && t.updatedAt > attestCutoff).length
    : scoped.filter(t => t.attestedBy === "admin" && t.updatedAt && t.updatedAt > attestCutoff).length;

  const byCategory = data.categories.map(c => ({ id: c.id, label: `${c.icon} ${c.name}`, value: openTickets.filter(t => t.categoryId === c.id).length, color: c.color }));
  const maxCat = Math.max(1, ...byCategory.map(c => c.value));
  const byStatus = sortedStatuses(data).map(s => ({ id: s.id, label: s.label, value: scoped.filter(t => t.status === s.id).length, color: s.color }));
  const maxStatus = Math.max(1, ...byStatus.map(s => s.value));
  const byPriority = sortedPriorities(data).map(p => ({ id: p.id, label: p.label, value: openTickets.filter(t => t.priority === p.id).length, color: p.color }));
  const maxPrio = Math.max(1, ...byPriority.map(p => p.value));

  const recent = [...scoped].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, 5);

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Painel</h1>
          <p className="text-sm mt-1" style={{ color: "var(--muted)" }}>Visão geral das demandas{storeFilter ? " da loja selecionada" : " em todas as lojas"}.</p>
        </div>
        {isAdmin ? (
          <Select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} style={{ width: 200 }}>
            <option value="">Todas as lojas</option>
            {data.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        ) : (
          <Pill label={data.stores.find(s => s.id === myStoreId)?.name || "Sua loja"} color="var(--accent)" soft="var(--accent-soft)" />
        )}
      </div>

      <div className="flex gap-4 mt-6 flex-wrap">
        <KpiCard label="Demandas abertas" value={openTickets.length} onClick={() => onGoTickets({ store: storeFilter, onlyOpen: true })} />
        <KpiCard label="Demandas Vencidas" value={overdue.length} tone={overdue.length ? "var(--danger)" : "var(--ink)"} onClick={() => onGoTickets({ store: storeFilter, onlyOverdue: true })} />
        <KpiCard label="No Prazo (Em dia)" value={onTime.length} tone="var(--ok)" onClick={() => onGoTickets({ store: storeFilter, onlyOpen: true, onlyOnTime: true })} />
        <KpiCard label={top ? `${top.label} em aberto` : "Prioridade crítica"} value={topOpen} tone={topOpen ? top.color : "var(--ink)"} onClick={() => onGoTickets({ store: storeFilter, onlyOpen: true, priority: top?.id })} />
        <KpiCard label="Alertas próx. 30 dias" value={upcomingAlerts.length} tone={upcomingAlerts.length ? "var(--warn)" : "var(--ink)"} onClick={onGoAlerts} />
        <KpiCard label={isAdmin ? "Atestadas pela loja" : "Atestadas pelo admin"} value={attestedByOther} tone={attestedByOther ? "var(--warn)" : "var(--ink)"}
          onClick={() => onGoTickets({ store: storeFilter, attestedBy: isAdmin ? "loja" : "admin" })} />
      </div>

      <div className="grid grid-cols-2 gap-4 mt-6">
        <PanelBar title="Demandas abertas por categoria" items={byCategory} max={maxCat} empty="Nenhuma demanda aberta."
          onItemClick={i => onGoTickets({ store: storeFilter, category: i.id, onlyOpen: true })} />
        <PanelBar title="Demandas por status" items={byStatus} max={maxStatus} empty="Nenhuma demanda registrada."
          onItemClick={i => onGoTickets({ store: storeFilter, status: i.id })} />
      </div>

      <div className="grid grid-cols-2 gap-4 mt-4">
        <PanelBar title="Demandas abertas por prioridade" items={byPriority} max={maxPrio} empty="Nenhuma demanda aberta."
          onItemClick={i => onGoTickets({ store: storeFilter, priority: i.id, onlyOpen: true })} />
        <div className="rounded-xl p-5" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>Últimas demandas</p>
            <button onClick={() => onGoTickets({ store: storeFilter })} className="text-xs font-medium" style={{ color: "var(--accent)" }}>ver todas</button>
          </div>
          {recent.length === 0 ? <p className="text-xs" style={{ color: "var(--faint)" }}>Nenhuma demanda registrada ainda.</p> : recent.map(t => {
            const st = findStatus(data, t.status);
            return (
              <button key={t.id} onClick={() => onGoTickets({ store: storeFilter }, t.id)}
                className="flex items-center justify-between py-2 w-full text-left hover:opacity-70 transition" style={{ borderTop: "1px solid var(--border)" }}>
                <div className="min-w-0">
                  <p className="text-xs" style={{ color: "var(--faint)", fontFamily: "var(--font-mono)" }}>{osCode(t)}</p>
                  <p className="text-sm truncate" style={{ color: "var(--ink)" }}>{t.title}</p>
                </div>
                <Pill label={st.label} color={st.color} soft={st.soft} />
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl p-5 mt-4" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>Próximos alertas</p>
          <button onClick={onGoAlerts} className="text-xs font-medium" style={{ color: "var(--accent)" }}>ver todos</button>
        </div>
        {upcomingAlerts.length === 0 ? <p className="text-xs" style={{ color: "var(--faint)" }}>Nenhum alerta nos próximos 30 dias.</p> : (
          <div className="grid grid-cols-2 gap-x-6">
            {upcomingAlerts.slice(0, 6).map(a => {
              const dd = daysDiff(a.dueDate);
              return (
                <button key={a.id} onClick={onGoAlerts} className="flex items-center justify-between py-2 w-full text-left hover:opacity-70 transition" style={{ borderTop: "1px solid var(--border)" }}>
                  <div className="min-w-0"><p className="text-sm truncate" style={{ color: "var(--ink)" }}>{a.title}</p><p className="text-xs" style={{ color: "var(--faint)" }}>{fmtDate(a.dueDate)}</p></div>
                  <Pill label={dd < 0 ? `${Math.abs(dd)}d atrasado` : `em ${dd}d`} color={dd < 0 ? "var(--danger)" : "var(--warn)"} soft={dd < 0 ? "var(--danger-soft)" : "var(--warn-soft)"} />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tickets                                                              */
/* ------------------------------------------------------------------ */

function TicketForm({ initial, data, currentUser, onCancel, onSave }) {
  const defaultStatus = (data.statuses.find(s => !s.closed) || data.statuses[0])?.id || "";
  const defaultPriority = (sortedPriorities(data)[Math.floor((data.priorities.length - 1) / 2)] || data.priorities[0])?.id || "";
  const isLoja = currentUser?.role === "loja";
  const lockedStoreId = isLoja ? (currentUser?.storeId || "") : "";
  const [f, setF] = useState(initial || {
    title: "", description: "", categoryId: data.categories[0]?.id || "", storeId: lockedStoreId || data.stores[0]?.id || "",
    priority: defaultPriority, status: defaultStatus, assigneeId: "", attachments: [],
    createAlert: false, alertDate: "", alertRecurrence: "anual", alertTitle: "",
  });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  const selectedCategory = data.categories.find(c => c.id === f.categoryId);

  function handleFiles(e) {
    const files = Array.from(e.target.files || []);
    files.forEach(file => {
      if (file.size > 3 * 1024 * 1024) { alert(`"${file.name}" é maior que 3MB e não será anexado.`); return; }
      const reader = new FileReader();
      reader.onload = () => setF(prev => ({ ...prev, attachments: [...prev.attachments, { id: uid(), name: file.name, type: file.type, size: file.size, dataUrl: reader.result }] }));
      reader.readAsDataURL(file);
    });
    e.target.value = "";
  }
  function removeAttachment(id) { setF(prev => ({ ...prev, attachments: prev.attachments.filter(a => a.id !== id) })); }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Título"><TextInput value={f.title} onChange={e => set("title", e.target.value)} placeholder="Ex: Ar-condicionado sem gelar" /></Field>
      <Field label="Descrição"><TextArea rows={3} value={f.description} onChange={e => set("description", e.target.value)} placeholder="Detalhes da necessidade de intervenção..." /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Loja">
          {lockedStoreId ? (
            <TextInput value={data.stores.find(s => s.id === lockedStoreId)?.name || ""} disabled style={{ backgroundColor: "#F3F4F7", color: "var(--muted)" }} />
          ) : (
            <Select value={f.storeId} onChange={e => set("storeId", e.target.value)}>{data.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          )}
        </Field>
        <Field label="Categoria" hint={selectedCategory ? `Prazo padrão de atendimento: ${selectedCategory.slaHours}h` : undefined}>
          <Select value={f.categoryId} onChange={e => set("categoryId", e.target.value)}>{data.categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</Select>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Prioridade"><Select value={f.priority} onChange={e => set("priority", e.target.value)}>{sortedPriorities(data).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}</Select></Field>
        {!isLoja && (
          <Field label="Status"><Select value={f.status} onChange={e => set("status", e.target.value)}>{sortedStatuses(data).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</Select></Field>
        )}
      </div>
      <Field label="Responsável (opcional)">
        <Select value={f.assigneeId} onChange={e => set("assigneeId", e.target.value)}>
          <option value="">Sem responsável definido</option>
          {data.users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
      </Field>

      <Field label="Anexos (fotos e documentos)">
        <label className="flex items-center gap-2 justify-center rounded-md py-3 cursor-pointer text-xs font-medium" style={{ border: "1px dashed var(--border)", color: "var(--muted)" }}>
          <Paperclip size={14} /> Selecionar arquivos (até 3MB cada)
          <input type="file" multiple className="hidden" onChange={handleFiles} />
        </label>
        {f.attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {f.attachments.map(a => (
              <div key={a.id} className="flex items-center gap-1.5 px-2 py-1 rounded text-xs" style={{ backgroundColor: "#EEF0F3", color: "var(--ink)" }}>
                <span className="truncate max-w-[140px]">{a.name}</span>
                <button onClick={() => removeAttachment(a.id)}><X size={12} /></button>
              </div>
            ))}
          </div>
        )}
      </Field>

      <div className="rounded-md p-3" style={{ backgroundColor: "var(--accent-soft)" }}>
        <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer" style={{ color: "var(--accent-ink)" }}>
          <input type="checkbox" checked={f.createAlert} onChange={e => set("createAlert", e.target.checked)} />
          Criar alerta de vencimento a partir desta demanda
        </label>
        <p className="text-[11px] mt-1" style={{ color: "var(--accent-ink)" }}>Ex: trocou o extintor agora — programe o aviso para a próxima troca.</p>
        {f.createAlert && (
          <div className="grid grid-cols-2 gap-2 mt-2">
            <TextInput placeholder="Título do alerta" value={f.alertTitle} onChange={e => set("alertTitle", e.target.value)} />
            <TextInput type="date" value={f.alertDate} onChange={e => set("alertDate", e.target.value)} />
            <Select value={f.alertRecurrence} onChange={e => set("alertRecurrence", e.target.value)} className="col-span-2">
              {RECURRENCES.filter(r => r.id !== "none").map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
            </Select>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 mt-2">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onSave(f)} disabled={!f.title.trim()}>Salvar demanda</Button>
      </div>
    </div>
  );
}

function TicketCard({ t, data, onOpen }) {
  const cat = data.categories.find(c => c.id === t.categoryId);
  const store = data.stores.find(s => s.id === t.storeId);
  const pr = findPriority(data, t.priority);
  const st = findStatus(data, t.status);
  const dd = t.dueDate ? daysDiff(t.dueDate) : null;
  const overdue = dd !== null && dd < 0 && !isClosedStatus(data, t.status);
  return (
    <button onClick={onOpen} className="w-full text-left rounded-xl p-4 flex gap-3 hover:shadow-sm transition"
      style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderLeft: `3px solid ${pr.color}` }}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[11px]" style={{ color: "var(--faint)", fontFamily: "var(--font-mono)" }}>{osCode(t)}</span>
          <span className="text-[11px]" style={{ color: "var(--faint)" }}>{cat?.icon} {cat?.name}</span>
        </div>
        <p className="text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>{t.title}</p>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{store?.name}</p>
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <Pill label={st.label} color={st.color} soft={st.soft} />
        <Pill label={pr.label} color={pr.color} soft={pr.soft} />
        {t.dueDate && <span className="text-[11px]" style={{ color: overdue ? "var(--danger)" : "var(--faint)" }}>{overdue ? `atrasada ${Math.abs(dd)}d` : fmtDate(t.dueDate)}</span>}
      </div>
    </button>
  );
}

function TicketDetail({ ticket, data, currentUser, onClose, onUpdate, onDelete }) {
  const [comment, setComment] = useState("");
  const [pendingFiles, setPendingFiles] = useState([]);
  const [attestOpen, setAttestOpen] = useState(false);
  const [attestNote, setAttestNote] = useState("");
  const [attestPhoto, setAttestPhoto] = useState(null);
  const cat = data.categories.find(c => c.id === ticket.categoryId);
  const store = data.stores.find(s => s.id === ticket.storeId);
  const requester = data.users.find(u => u.id === ticket.requesterId);
  const assignee = data.users.find(u => u.id === ticket.assigneeId);
  // Após aberta, somente o administrador pode alterar a demanda (status, prazo, orçamento, observação, anexos gerais).
  // Qualquer perfil pode comentar e anexar arquivos vinculados ao próprio comentário.
  const canTreat = currentUser?.role === "admin";
  const isLojaOwner = currentUser?.role === "loja" && currentUser.storeId === ticket.storeId;
  const isAdminUser = currentUser?.role === "admin";
  const awaitingAttest = ticket.status === "aguardando_atesto";
  const canAttest = (isLojaOwner || isAdminUser) && !isClosedStatus(data, ticket.status);

  async function readFiles(fileList) {
    const files = Array.from(fileList || []);
    const valid = files.filter(file => {
      if (file.size > 3 * 1024 * 1024) { alert(`"${file.name}" é maior que 3MB e não será anexado.`); return false; }
      return true;
    });
    const readOne = (file) => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve({ id: uid(), name: file.name, type: file.type, size: file.size, dataUrl: reader.result });
      reader.readAsDataURL(file);
    });
    return Promise.all(valid.map(readOne));
  }

  function addComment() {
    if (!comment.trim() && pendingFiles.length === 0) return;
    const c = { id: uid(), author: currentUser?.name || "Usuário", text: comment.trim(), createdAt: new Date().toISOString(), attachments: pendingFiles };
    onUpdate({ ...ticket, comments: [...ticket.comments, c] });
    setComment("");
    setPendingFiles([]);
  }
  async function handleCommentFiles(e) {
    const results = await readFiles(e.target.files);
    if (results.length) setPendingFiles(prev => [...prev, ...results]);
    e.target.value = "";
  }
  function removePendingFile(id) { setPendingFiles(prev => prev.filter(f => f.id !== id)); }

  function setStatus(status) { onUpdate({ ...ticket, status }); }
  function markAwaitingAttest() { onUpdate({ ...ticket, status: "aguardando_atesto" }); }

  async function handleDetailFiles(e) {
    const results = await readFiles(e.target.files);
    if (results.length) onUpdate({ ...ticket, attachments: [...ticket.attachments, ...results] });
    e.target.value = "";
  }

  async function handleAttestPhoto(e) {
    const results = await readFiles(e.target.files);
    if (results.length) setAttestPhoto(results[0]);
    e.target.value = "";
  }
  function submitAttest(resolved) {
    const noteText = attestNote.trim();
    const byLabel = isAdminUser ? "administrador" : "loja";
    const commentText = resolved
      ? `Demanda atestada como resolvida pelo(a) ${byLabel}.${noteText ? " " + noteText : ""}`
      : `A demanda foi identificada como NÃO resolvida pelo(a) ${byLabel}.${noteText ? " " + noteText : ""}`;
    const c = { id: uid(), author: currentUser?.name || "Usuário", text: commentText, createdAt: new Date().toISOString(), attachments: attestPhoto ? [attestPhoto] : [] };
    onUpdate({ ...ticket, status: resolved ? "concluida" : "nao_atestada", attestedBy: isAdminUser ? "admin" : "loja", attestedAt: new Date().toISOString(), comments: [...ticket.comments, c] });
    setAttestOpen(false); setAttestNote(""); setAttestPhoto(null);
  }

  return (
    <Modal title={osCode(ticket)} onClose={onClose} width={640}>
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Pill label={findStatus(data, ticket.status).label} color={findStatus(data, ticket.status).color} soft={findStatus(data, ticket.status).soft} />
        <Pill label={findPriority(data, ticket.priority).label} color={findPriority(data, ticket.priority).color} soft={findPriority(data, ticket.priority).soft} />
        <span className="text-xs" style={{ color: "var(--faint)" }}>{cat?.icon} {cat?.name} · {store?.name}</span>
      </div>
      <h3 className="text-lg font-bold mb-1" style={{ color: "var(--ink)" }}>{ticket.title}</h3>
      <p className="text-sm mb-4 whitespace-pre-wrap" style={{ color: "var(--muted)" }}>{ticket.description || "Sem descrição adicional."}</p>

      <div className="grid grid-cols-2 gap-3 text-xs mb-4">
        <div><span style={{ color: "var(--faint)" }}>Solicitante: </span><span style={{ color: "var(--ink)" }}>{requester?.name || "—"}</span></div>
        <div><span style={{ color: "var(--faint)" }}>Responsável: </span><span style={{ color: "var(--ink)" }}>{assignee?.name || "Não definido"}</span></div>
        <div><span style={{ color: "var(--faint)" }}>Aberta em: </span><span style={{ color: "var(--ink)" }}>{fmtDateTime(ticket.createdAt)}</span></div>
        <div>
          <span style={{ color: "var(--faint)" }}>Prazo: </span>
          {canTreat ? (
            <input type="date" value={ticket.dueDate || ""} onChange={e => onUpdate({ ...ticket, dueDate: e.target.value })}
              style={{ fontSize: 12, fontFamily: "var(--font-ui)", border: "1px solid var(--border)", borderRadius: 4, padding: "2px 4px", color: "var(--ink)" }} />
          ) : (
            <span style={{ color: "var(--ink)" }}>{fmtDate(ticket.dueDate)}</span>
          )}
        </div>
      </div>

      {canAttest && (
        <div className="mb-4 rounded-md p-3" style={{ backgroundColor: awaitingAttest ? "var(--ok-soft)" : "#F7F8FA", border: awaitingAttest ? "1px solid var(--ok)" : "1px solid var(--border)" }}>
          {awaitingAttest ? (
            isAdminUser ? (
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--accent-ink)" }}>Aguardando confirmação da loja. Se necessário, você também pode confirmar em nome dela.</p>
            ) : (
              <p className="text-xs font-semibold mb-2" style={{ color: "var(--accent-ink)" }}>O administrador marcou esta demanda como concluída. Confirma que foi resolvida?</p>
            )
          ) : (
            <p className="text-xs font-semibold mb-2" style={{ color: "var(--muted)" }}>
              {isAdminUser ? "Você pode atestar a conclusão desta demanda. A loja será avisada." : "Essa demanda já foi resolvida? Você pode atestar a conclusão."}
            </p>
          )}
          {!attestOpen ? (
            <Button size="sm" onClick={() => setAttestOpen(true)}><Check size={13} /> Atestar demanda</Button>
          ) : (
            <div className="flex flex-col gap-2">
              <TextArea rows={2} placeholder="Observação (opcional)" value={attestNote} onChange={e => setAttestNote(e.target.value)} />
              <label className="flex items-center gap-2 justify-center rounded-md py-2 cursor-pointer text-xs font-medium" style={{ border: "1px dashed var(--border)", color: "var(--muted)" }}>
                <Paperclip size={13} /> {attestPhoto ? attestPhoto.name : "Anexar foto (opcional)"}
                <input type="file" accept="image/*" className="hidden" onChange={handleAttestPhoto} />
              </label>
              <div className="flex gap-2 justify-end flex-wrap">
                <Button variant="outline" size="sm" onClick={() => { setAttestOpen(false); setAttestNote(""); setAttestPhoto(null); }}>Cancelar</Button>
                {awaitingAttest && <Button variant="danger" size="sm" onClick={() => submitAttest(false)}>Não, não foi resolvida</Button>}
                <Button size="sm" onClick={() => submitAttest(true)}>{awaitingAttest ? "Sim, foi resolvida" : "Confirmar conclusão"}</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {canTreat && (
        <div className="mb-4">
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--muted)" }}>Mudar status</p>
          <div className="flex flex-wrap gap-1.5">
            {sortedStatuses(data).filter(s => !ATTEST_FLOW_STATUS_IDS.includes(s.id) && s.id !== "nao_atestada").map(s => (
              <button key={s.id} onClick={() => setStatus(s.id)} className="px-2.5 py-1 rounded text-xs font-medium"
                style={{ backgroundColor: ticket.status === s.id ? s.color : s.soft, color: ticket.status === s.id ? "#fff" : s.color }}>
                {s.label}
              </button>
            ))}
          </div>
          {!isClosedStatus(data, ticket.status) && ticket.status !== "aguardando_atesto" && (
            <button onClick={markAwaitingAttest} className="mt-2 px-2.5 py-1 rounded text-xs font-medium" style={{ backgroundColor: "var(--ok-soft)", color: "var(--ok)" }}>
              <Check size={12} style={{ display: "inline", marginRight: 4, verticalAlign: -2 }} />Marcar como concluída (aguardar confirmação da loja)
            </button>
          )}
        </div>
      )}

      {(canTreat || ticket.budget || ticket.serviceNotes) && (
        <div className="mb-4 rounded-md p-3" style={{ backgroundColor: "#F7F8FA" }}>
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--muted)" }}>Tratamento da demanda</p>
          <div className="mb-3">
            <Field label="Orçamento (R$)">
              {canTreat ? (
                <TextInput type="number" step="0.01" min="0" value={ticket.budget ?? ""} onChange={e => onUpdate({ ...ticket, budget: e.target.value })} placeholder="0,00" style={{ maxWidth: 160 }} />
              ) : (
                <p className="text-sm" style={{ color: "var(--ink)" }}>{ticket.budget ? `R$ ${Number(ticket.budget).toFixed(2)}` : "—"}</p>
              )}
            </Field>
          </div>
          <Field label="Observação (prestador de serviço / detalhes do atendimento)">
            {canTreat ? (
              <TextArea rows={2} value={ticket.serviceNotes || ""} onChange={e => onUpdate({ ...ticket, serviceNotes: e.target.value })} placeholder="Ex: Prestador ABC Refrigeração, contato (67) 99999-0000, peça substituída..." />
            ) : (
              <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--ink)" }}>{ticket.serviceNotes || "—"}</p>
            )}
          </Field>
        </div>
      )}

      {(ticket.attachments.length > 0 || canTreat) && (
        <div className="mb-4">
          <p className="text-xs font-semibold mb-2" style={{ color: "var(--muted)" }}>Anexos gerais</p>
          {ticket.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {ticket.attachments.map(a => (
                <a key={a.id} href={a.dataUrl} download={a.name} className="flex flex-col items-center gap-1 w-20">
                  {a.type?.startsWith("image/") ? (
                    <img src={a.dataUrl} alt={a.name} className="w-20 h-20 object-cover rounded-md" style={{ border: "1px solid var(--border)" }} />
                  ) : (
                    <div className="w-20 h-20 flex items-center justify-center rounded-md" style={{ backgroundColor: "#EEF0F3" }}><Paperclip size={20} color="var(--muted)" /></div>
                  )}
                  <span className="text-[10px] truncate w-full text-center" style={{ color: "var(--muted)" }}>{a.name}</span>
                </a>
              ))}
            </div>
          )}
          {canTreat && (
            <label className="flex items-center gap-2 justify-center rounded-md py-2 cursor-pointer text-xs font-medium" style={{ border: "1px dashed var(--border)", color: "var(--muted)" }}>
              <Paperclip size={13} /> Anexar arquivo (até 3MB cada)
              <input type="file" multiple className="hidden" onChange={handleDetailFiles} />
            </label>
          )}
        </div>
      )}

      <div className="mb-2">
        <p className="text-xs font-semibold mb-2" style={{ color: "var(--muted)" }}>Comentários</p>
        <div className="flex flex-col gap-2 mb-2 max-h-48 overflow-y-auto">
          {ticket.comments.length === 0 && <p className="text-xs" style={{ color: "var(--faint)" }}>Nenhum comentário ainda.</p>}
          {ticket.comments.map(c => (
            <div key={c.id} className="text-xs rounded-md p-2" style={{ backgroundColor: "#F7F8FA" }}>
              <span className="font-semibold" style={{ color: "var(--ink)" }}>{c.author}</span>
              <span style={{ color: "var(--faint)" }}> · {fmtDateTime(c.createdAt)}</span>
              {c.text && <p style={{ color: "var(--ink)" }}>{c.text}</p>}
              {c.attachments && c.attachments.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {c.attachments.map(a => (
                    <a key={a.id} href={a.dataUrl} download={a.name} className="flex items-center gap-1 px-1.5 py-1 rounded" style={{ backgroundColor: "#fff", border: "1px solid var(--border)" }}>
                      {a.type?.startsWith("image/") ? (
                        <img src={a.dataUrl} alt={a.name} className="w-6 h-6 object-cover rounded" />
                      ) : (
                        <Paperclip size={11} color="var(--muted)" />
                      )}
                      <span className="truncate max-w-[90px]" style={{ color: "var(--ink)" }}>{a.name}</span>
                    </a>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <TextInput placeholder="Adicionar comentário..." value={comment} onChange={e => setComment(e.target.value)} onKeyDown={e => e.key === "Enter" && addComment()} />
            <label className="flex items-center justify-center px-2.5 rounded-md cursor-pointer shrink-0" style={{ border: "1px solid var(--border)", color: "var(--muted)" }} title="Anexar arquivo ao comentário">
              <Paperclip size={15} />
              <input type="file" multiple className="hidden" onChange={handleCommentFiles} />
            </label>
            <Button onClick={addComment}><MessageSquare size={14} /></Button>
          </div>
          {pendingFiles.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {pendingFiles.map(f => (
                <div key={f.id} className="flex items-center gap-1.5 px-2 py-1 rounded text-xs" style={{ backgroundColor: "#EEF0F3", color: "var(--ink)" }}>
                  <span className="truncate max-w-[120px]">{f.name}</span>
                  <button onClick={() => removePendingFile(f.id)}><X size={12} /></button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-between mt-4 pt-3" style={{ borderTop: "1px solid var(--border)" }}>
        {canTreat ? (
          <Button variant="danger" onClick={() => { if (confirm("Excluir esta demanda?")) onDelete(ticket.id); }}><Trash2 size={14} /> Excluir</Button>
        ) : <span />}
        <Button variant="outline" onClick={onClose}>Fechar</Button>
      </div>
    </Modal>
  );
}

function TicketsView({ data, update, currentUser, initialFilters, initialOpenId }) {
  const isAdmin = currentUser?.role === "admin";
  const myStoreId = !isAdmin ? (currentUser?.storeId || "") : "";

  // Filtros em rascunho (digitados nos campos antes de clicar em Consultar)
  const [draftQ, setDraftQ] = useState(initialFilters?.q || "");
  const [draftStore, setDraftStore] = useState(initialFilters?.store || "");
  const [draftCat, setDraftCat] = useState(initialFilters?.category || "");
  const [draftStatus, setDraftStatus] = useState(initialFilters?.status || "");
  const [draftPrio, setDraftPrio] = useState(initialFilters?.priority || "");
  const [draftOnlyOpen, setDraftOnlyOpen] = useState(!!initialFilters?.onlyOpen);
  const [draftOnlyOverdue, setDraftOnlyOverdue] = useState(!!initialFilters?.onlyOverdue);
  const [draftOnlyOnTime, setDraftOnlyOnTime] = useState(!!initialFilters?.onlyOnTime);
  const [draftAttestedBy, setDraftAttestedBy] = useState(initialFilters?.attestedBy || "");
  const [draftDateFrom, setDraftDateFrom] = useState(initialFilters?.dateFrom || "");
  const [draftDateTo, setDraftDateTo] = useState(initialFilters?.dateTo || "");

  // Filtros efetivamente aplicados na listagem de dados
  const [applied, setApplied] = useState(() => ({
    q: initialFilters?.q || "",
    store: initialFilters?.store || "",
    category: initialFilters?.category || "",
    status: initialFilters?.status || "",
    priority: initialFilters?.priority || "",
    onlyOpen: !!initialFilters?.onlyOpen,
    onlyOverdue: !!initialFilters?.onlyOverdue,
    onlyOnTime: !!initialFilters?.onlyOnTime,
    attestedBy: initialFilters?.attestedBy || "",
    dateFrom: initialFilters?.dateFrom || "",
    dateTo: initialFilters?.dateTo || ""
  }));

  const [showForm, setShowForm] = useState(false);
  const [openTicket, setOpenTicket] = useState(() => initialOpenId ? (data.tickets.find(t => t.id === initialOpenId) || null) : null);
  const [confirmInfo, setConfirmInfo] = useState(null);

  // Sincroniza quando houver navegação vinda do Dashboard
  useEffect(() => {
    if (initialFilters) {
      const next = {
        q: initialFilters.q || "",
        store: initialFilters.store || "",
        category: initialFilters.category || "",
        status: initialFilters.status || "",
        priority: initialFilters.priority || "",
        onlyOpen: !!initialFilters.onlyOpen,
        onlyOverdue: !!initialFilters.onlyOverdue,
        onlyOnTime: !!initialFilters.onlyOnTime,
        attestedBy: initialFilters.attestedBy || "",
        dateFrom: initialFilters.dateFrom || "",
        dateTo: initialFilters.dateTo || ""
      };
      setDraftQ(next.q);
      setDraftStore(next.store);
      setDraftCat(next.category);
      setDraftStatus(next.status);
      setDraftPrio(next.priority);
      setDraftOnlyOpen(next.onlyOpen);
      setDraftOnlyOverdue(next.onlyOverdue);
      setDraftOnlyOnTime(next.onlyOnTime);
      setDraftAttestedBy(next.attestedBy);
      setDraftDateFrom(next.dateFrom);
      setDraftDateTo(next.dateTo);
      setApplied(next);
    }
  }, [initialFilters]);

  function handleConsultar() {
    setApplied({
      q: draftQ,
      store: draftStore,
      category: draftCat,
      status: draftStatus,
      priority: draftPrio,
      onlyOpen: draftOnlyOpen,
      onlyOverdue: draftOnlyOverdue,
      onlyOnTime: draftOnlyOnTime,
      attestedBy: draftAttestedBy,
      dateFrom: draftDateFrom,
      dateTo: draftDateTo
    });
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      handleConsultar();
    }
  }

  function clearFilters() {
    setDraftQ("");
    setDraftStore("");
    setDraftCat("");
    setDraftStatus("");
    setDraftPrio("");
    setDraftOnlyOpen(false);
    setDraftOnlyOverdue(false);
    setDraftOnlyOnTime(false);
    setDraftAttestedBy("");
    setDraftDateFrom("");
    setDraftDateTo("");
    setApplied({
      q: "",
      store: "",
      category: "",
      status: "",
      priority: "",
      onlyOpen: false,
      onlyOverdue: false,
      onlyOnTime: false,
      attestedBy: "",
      dateFrom: "",
      dateTo: ""
    });
  }

  const hasActiveFilter = applied.q || applied.store || applied.category || applied.status || applied.priority || applied.onlyOpen || applied.onlyOverdue || applied.onlyOnTime || applied.dateFrom || applied.dateTo || applied.attestedBy;

  const scopedTickets = myStoreId ? data.tickets.filter(t => t.storeId === myStoreId) : data.tickets;
  const filtered = scopedTickets.filter(t =>
    (!applied.q || t.title.toLowerCase().includes(applied.q.toLowerCase()) || osCode(t).toLowerCase().includes(applied.q.toLowerCase())) &&
    (!applied.store || t.storeId === applied.store) &&
    (!applied.category || t.categoryId === applied.category) &&
    (!applied.status || t.status === applied.status) &&
    (!applied.priority || t.priority === applied.priority) &&
    (!applied.attestedBy || t.attestedBy === applied.attestedBy) &&
    (!applied.onlyOpen || !isClosedStatus(data, t.status)) &&
    (!applied.onlyOverdue || (t.dueDate && daysDiff(t.dueDate) < 0 && !isClosedStatus(data, t.status))) &&
    (!applied.onlyOnTime || ((!t.dueDate || daysDiff(t.dueDate) >= 0) && !isClosedStatus(data, t.status))) &&
    (!applied.dateFrom || t.createdAt.slice(0, 10) >= applied.dateFrom) &&
    (!applied.dateTo || t.createdAt.slice(0, 10) <= applied.dateTo)
  ).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  function saveTicket(f) {
    const { year, seq } = nextSeq(data.tickets);
    const category = data.categories.find(c => c.id === f.categoryId);
    const now = new Date().toISOString();
    const ticket = {
      id: uid(), year, seq, title: f.title, description: f.description, categoryId: f.categoryId, storeId: f.storeId,
      priority: f.priority, status: f.status, requesterId: currentUser?.id || data.users[0]?.id || "", assigneeId: f.assigneeId,
      createdAt: now, updatedAt: now, dueDate: calcDueDate(category?.slaHours, now),
      attachments: f.attachments, comments: [], history: [], budget: "", serviceNotes: "", attestedBy: "", attestedAt: "",
    };
    let alerts = data.alerts;
    if (f.createAlert && f.alertDate) {
      alerts = [...alerts, { id: uid(), title: f.alertTitle || `Vencimento: ${f.title}`, storeId: f.storeId, categoryId: f.categoryId, dueDate: f.alertDate, recurrence: f.alertRecurrence, status: "ativo", notes: `Gerado a partir de ${osCode(ticket)}.`, createdAt: new Date().toISOString(), linkedTicketId: ticket.id }];
    }
    update("tickets", [...data.tickets, ticket]);
    if (alerts !== data.alerts) update("alerts", alerts);
    setShowForm(false);
    setConfirmInfo({ code: osCode(ticket), title: ticket.title, dueDate: ticket.dueDate });
  }
  function updateTicket(t) { update("tickets", data.tickets.map(x => x.id === t.id ? { ...t, updatedAt: new Date().toISOString() } : x)); setOpenTicket({ ...t, updatedAt: new Date().toISOString() }); }
  function deleteTicket(id) { update("tickets", data.tickets.filter(x => x.id !== id)); setOpenTicket(null); }

  return (
    <div className="p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Demandas</h1>
        <Button onClick={() => setShowForm(true)}><Plus size={15} /> Nova demanda</Button>
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--muted)" }}>{filtered.length} de {scopedTickets.length} demandas</p>

      {/* Barra de Filtros com Botão de Consulta */}
      <div className="p-4 rounded-xl mb-5" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5" color="var(--faint)" />
            <TextInput
              placeholder="Buscar por título ou OS..."
              value={draftQ}
              onChange={e => setDraftQ(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{ paddingLeft: 28, width: 220 }}
            />
          </div>
          {isAdmin && (
            <Select value={draftStore} onChange={e => setDraftStore(e.target.value)} style={{ width: 150 }}>
              <option value="">Todas as lojas</option>
              {data.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          )}
          <Select value={draftCat} onChange={e => setDraftCat(e.target.value)} style={{ width: 160 }}>
            <option value="">Todas categorias</option>
            {data.categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </Select>
          <Select value={draftStatus} onChange={e => setDraftStatus(e.target.value)} style={{ width: 140 }}>
            <option value="">Todos status</option>
            {sortedStatuses(data).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </Select>
          <Select value={draftPrio} onChange={e => setDraftPrio(e.target.value)} style={{ width: 130 }}>
            <option value="">Toda prioridade</option>
            {sortedPriorities(data).map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </Select>
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium" style={{ color: "var(--faint)" }}>De:</span>
            <TextInput
              type="date"
              value={draftDateFrom}
              onChange={e => setDraftDateFrom(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{ width: 136 }}
            />
          </div>
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium" style={{ color: "var(--faint)" }}>Até:</span>
            <TextInput
              type="date"
              value={draftDateTo}
              onChange={e => setDraftDateTo(e.target.value)}
              onKeyDown={handleKeyDown}
              style={{ width: 136 }}
            />
          </div>
          
          <Button onClick={handleConsultar} size="sm">
            <Search size={14} /> Consultar
          </Button>

          {hasActiveFilter && (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              <X size={14} /> Limpar
            </Button>
          )}
        </div>

        {/* Tags de Filtros Ativos */}
        {hasActiveFilter && (
          <div className="flex items-center gap-2 mt-3 pt-3 flex-wrap text-xs" style={{ borderTop: "1px solid var(--border)" }}>
            <span className="font-semibold text-gray-500">Filtros ativos:</span>
            {applied.q && <Pill label={`Busca: "${applied.q}"`} color="var(--accent)" soft="var(--accent-soft)" />}
            {applied.store && <Pill label={`Loja: ${data.stores.find(s => s.id === applied.store)?.name || applied.store}`} color="var(--accent)" soft="var(--accent-soft)" />}
            {applied.category && <Pill label={`Categoria: ${data.categories.find(c => c.id === applied.category)?.name || applied.category}`} color="var(--accent)" soft="var(--accent-soft)" />}
            {applied.status && <Pill label={`Status: ${findStatus(data, applied.status).label}`} color="var(--accent)" soft="var(--accent-soft)" />}
            {applied.priority && <Pill label={`Prioridade: ${findPriority(data, applied.priority).label}`} color="var(--accent)" soft="var(--accent-soft)" />}
            {applied.onlyOpen && <Pill label="somente abertas" color="var(--accent)" soft="var(--accent-soft)" />}
            {applied.onlyOverdue && <Pill label="somente atrasadas (vencidas)" color="var(--danger)" soft="var(--danger-soft)" />}
            {applied.onlyOnTime && <Pill label="somente no prazo" color="var(--ok)" soft="var(--ok-soft)" />}
            {applied.attestedBy && <Pill label={applied.attestedBy === "loja" ? "atestadas pela loja" : "atestadas pelo administrador"} color="var(--warn)" soft="var(--warn-soft)" />}
            {applied.dateFrom && <Pill label={`A partir de: ${fmtDate(applied.dateFrom)}`} color="var(--accent)" soft="var(--accent-soft)" />}
            {applied.dateTo && <Pill label={`Até: ${fmtDate(applied.dateTo)}`} color="var(--accent)" soft="var(--accent-soft)" />}
          </div>
        )}
      </div>

      {filtered.length === 0 ? <EmptyState icon={<ClipboardList size={32} />} title="Nenhuma demanda encontrada" sub="Ajuste os filtros e clique em Consultar, ou crie uma nova demanda." /> : (
        <div className="flex flex-col gap-2.5">{filtered.map(t => <TicketCard key={t.id} t={t} data={data} onOpen={() => setOpenTicket(t)} />)}</div>
      )}

      {showForm && <Modal title="Nova demanda" onClose={() => setShowForm(false)} width={560}><TicketForm data={data} currentUser={currentUser} onCancel={() => setShowForm(false)} onSave={saveTicket} /></Modal>}
      {openTicket && <TicketDetail ticket={openTicket} data={data} currentUser={currentUser} onClose={() => setOpenTicket(null)} onUpdate={updateTicket} onDelete={deleteTicket} />}
      {confirmInfo && (
        <Modal title="Demanda aberta com sucesso" onClose={() => setConfirmInfo(null)}>
          <p className="text-xs mb-1" style={{ color: "var(--faint)", fontFamily: "var(--font-mono)" }}>{confirmInfo.code}</p>
          <p className="text-base font-semibold mb-3" style={{ color: "var(--ink)" }}>{confirmInfo.title}</p>
          <p className="text-sm" style={{ color: "var(--ink)" }}>Previsão de conclusão: <strong>{fmtDate(confirmInfo.dueDate)}</strong></p>
          <div className="flex justify-end mt-4"><Button onClick={() => setConfirmInfo(null)}>OK</Button></div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Alerts                                                               */
/* ------------------------------------------------------------------ */

function AlertForm({ initial, data, currentUser, onCancel, onSave }) {
  const lockedStoreId = currentUser?.role === "loja" ? (currentUser?.storeId || "") : "";
  const [f, setF] = useState(initial || { title: "", storeId: lockedStoreId || data.stores[0]?.id || "", categoryId: data.categories[0]?.id || "", dueDate: todayISO(), recurrence: "anual", notes: "" });
  const set = (k, v) => setF(prev => ({ ...prev, [k]: v }));
  return (
    <div className="flex flex-col gap-3">
      <Field label="Título"><TextInput value={f.title} onChange={e => set("title", e.target.value)} placeholder="Ex: Recarga do extintor de incêndio" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Loja">
          {lockedStoreId ? (
            <TextInput value={data.stores.find(s => s.id === lockedStoreId)?.name || ""} disabled style={{ backgroundColor: "#F3F4F7", color: "var(--muted)" }} />
          ) : (
            <Select value={f.storeId} onChange={e => set("storeId", e.target.value)}>{data.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
          )}
        </Field>
        <Field label="Categoria"><Select value={f.categoryId} onChange={e => set("categoryId", e.target.value)}>{data.categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}</Select></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Data de vencimento"><TextInput type="date" value={f.dueDate} onChange={e => set("dueDate", e.target.value)} /></Field>
        <Field label="Recorrência"><Select value={f.recurrence} onChange={e => set("recurrence", e.target.value)}>{RECURRENCES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</Select></Field>
      </div>
      <Field label="Observações"><TextArea rows={2} value={f.notes} onChange={e => set("notes", e.target.value)} /></Field>
      <div className="flex justify-end gap-2 mt-2">
        <Button variant="outline" onClick={onCancel}>Cancelar</Button>
        <Button onClick={() => onSave(f)} disabled={!f.title.trim()}>Salvar alerta</Button>
      </div>
    </div>
  );
}

function AlertsView({ data, update, currentUser }) {
  const myStoreId = currentUser?.role === "loja" ? (currentUser?.storeId || "") : "";
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);

  const sorted = [...data.alerts].filter(a => !myStoreId || a.storeId === myStoreId).sort((a, b) => {
    if (a.status !== b.status) return a.status === "ativo" ? -1 : 1;
    return daysDiff(a.dueDate) - daysDiff(b.dueDate);
  });

  function saveAlert(f) {
    if (editing) update("alerts", data.alerts.map(a => a.id === editing.id ? { ...a, ...f } : a));
    else update("alerts", [...data.alerts, { id: uid(), ...f, status: "ativo", createdAt: new Date().toISOString(), linkedTicketId: "" }]);
    setShowForm(false); setEditing(null);
  }
  function resolve(a) {
    if (a.recurrence === "none") update("alerts", data.alerts.map(x => x.id === a.id ? { ...x, status: "resolvido" } : x));
    else { const next = addRecurrence(a.dueDate, a.recurrence); update("alerts", data.alerts.map(x => x.id === a.id ? { ...x, dueDate: next } : x)); }
  }
  function removeAlert(id) { update("alerts", data.alerts.filter(a => a.id !== id)); }
  function openTicketFromAlert(a) {
    const store = data.stores.find(s => s.id === a.storeId);
    const { year, seq } = nextSeq(data.tickets);
    const defaultPriority = data.priorities[0]?.id || "";
    const defaultStatus = (data.statuses.find(s => !s.closed) || data.statuses[0])?.id || "";
    const ticket = {
      id: uid(), year, seq, title: a.title, description: `Demanda gerada a partir do alerta "${a.title}" (${store?.name || ""}).`,
      categoryId: a.categoryId, storeId: a.storeId, priority: defaultPriority, status: defaultStatus, requesterId: currentUser?.id || data.users[0]?.id || "",
      assigneeId: "", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), dueDate: a.dueDate, attachments: [], comments: [], history: [], budget: "", serviceNotes: "", attestedBy: "", attestedAt: "",
    };
    update("tickets", [...data.tickets, ticket]);
    update("alerts", data.alerts.map(x => x.id === a.id ? { ...x, linkedTicketId: ticket.id } : x));
  }

  return (
    <div className="p-8 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Alertas de vencimento</h1>
        <Button onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={15} /> Novo alerta</Button>
      </div>
      <p className="text-sm mb-5" style={{ color: "var(--muted)" }}>Lembretes recorrentes: extintores, licenças, manutenções preventivas e mais.</p>

      {sorted.length === 0 ? <EmptyState icon={<Bell size={32} />} title="Nenhum alerta cadastrado" sub="Crie um alerta para nunca perder um vencimento." /> : (
        <div className="flex flex-col gap-2.5">
          {sorted.map(a => {
            const store = data.stores.find(s => s.id === a.storeId);
            const cat = data.categories.find(c => c.id === a.categoryId);
            const dd = daysDiff(a.dueDate);
            const overdue = dd < 0 && a.status === "ativo";
            return (
              <div key={a.id} className="rounded-xl p-4 flex items-center gap-3" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", opacity: a.status === "resolvido" ? 0.6 : 1 }}>
                <div style={{ color: overdue ? "var(--danger)" : "var(--accent)" }}>{overdue ? <AlertTriangle size={18} /> : <CalendarClock size={18} />}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>{a.title}</p>
                  <p className="text-xs" style={{ color: "var(--muted)" }}>{store?.name} · {cat?.icon} {cat?.name} · {RECURRENCES.find(r => r.id === a.recurrence)?.label}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold" style={{ color: overdue ? "var(--danger)" : "var(--ink)" }}>{fmtDate(a.dueDate)}</p>
                  <p className="text-[11px]" style={{ color: "var(--faint)" }}>{a.status === "resolvido" ? "resolvido" : overdue ? `${Math.abs(dd)}d atrasado` : `em ${dd}d`}</p>
                </div>
                {a.status === "ativo" && (
                  <div className="flex gap-1 shrink-0">
                    <IconBtn title="Abrir demanda a partir do alerta" onClick={() => openTicketFromAlert(a)}><ClipboardList size={16} /></IconBtn>
                    <IconBtn title="Marcar como resolvido / renovar" onClick={() => resolve(a)}><Check size={16} /></IconBtn>
                    <IconBtn title="Editar" onClick={() => { setEditing(a); setShowForm(true); }}><Pencil size={16} /></IconBtn>
                  </div>
                )}
                <IconBtn title="Excluir" onClick={() => removeAlert(a.id)}><Trash2 size={16} /></IconBtn>
              </div>
            );
          })}
        </div>
      )}
      {showForm && <Modal title={editing ? "Editar alerta" : "Novo alerta"} onClose={() => { setShowForm(false); setEditing(null); }}><AlertForm initial={editing} data={data} currentUser={currentUser} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={saveAlert} /></Modal>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Admin: Stores / Categories / Users / Statuses / Priorities           */
/* ------------------------------------------------------------------ */

function StoresView({ data, update }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  function save(f) {
    if (editing) update("stores", data.stores.map(s => s.id === editing.id ? { ...s, ...f } : s));
    else update("stores", [...data.stores, { id: uid(), ...f }]);
    setShowForm(false); setEditing(null);
  }
  function remove(id) {
    if (data.tickets.some(t => t.storeId === id)) { alert("Esta loja possui demandas registradas e não pode ser excluída."); return; }
    update("stores", data.stores.filter(s => s.id !== id));
  }
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: "var(--muted)" }}>{data.stores.length} lojas cadastradas</p>
        <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={14} /> Nova loja</Button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {data.stores.map(s => (
          <div key={s.id} className="rounded-xl p-4" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{s.name}</p>
                <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{s.address}</p>
                <p className="text-xs" style={{ color: "var(--faint)" }}>{s.city}/{s.uf} · código {s.code}</p>
              </div>
              <div className="flex gap-1"><IconBtn onClick={() => { setEditing(s); setShowForm(true); }}><Pencil size={15} /></IconBtn><IconBtn onClick={() => remove(s.id)}><Trash2 size={15} /></IconBtn></div>
            </div>
            <Pill label={s.active ? "Ativa" : "Inativa"} color={s.active ? "var(--ok)" : "var(--muted)"} soft={s.active ? "var(--ok-soft)" : "#EEF0F3"} />
          </div>
        ))}
      </div>
      {showForm && <StoreFormModal initial={editing} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={save} />}
    </>
  );
}
function StoreFormModal({ initial, onCancel, onSave }) {
  const [f, setF] = useState(initial || { name: "", code: "", city: "", uf: "", address: "", active: true });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal title={initial ? "Editar loja" : "Nova loja"} onClose={onCancel}>
      <div className="flex flex-col gap-3">
        <Field label="Nome da loja"><TextInput value={f.name} onChange={e => set("name", e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Código"><TextInput value={f.code} onChange={e => set("code", e.target.value.toUpperCase())} /></Field>
          <Field label="UF"><TextInput value={f.uf} onChange={e => set("uf", e.target.value.toUpperCase())} maxLength={2} /></Field>
        </div>
        <Field label="Cidade"><TextInput value={f.city} onChange={e => set("city", e.target.value)} /></Field>
        <Field label="Endereço"><TextInput value={f.address} onChange={e => set("address", e.target.value)} /></Field>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={e => set("active", e.target.checked)} /> Loja ativa</label>
        <div className="flex justify-end gap-2 mt-2"><Button variant="outline" onClick={onCancel}>Cancelar</Button><Button onClick={() => onSave(f)} disabled={!f.name.trim()}>Salvar</Button></div>
      </div>
    </Modal>
  );
}

function CategoriesView({ data, update }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  function save(f) {
    if (editing) update("categories", data.categories.map(c => c.id === editing.id ? { ...c, ...f } : c));
    else update("categories", [...data.categories, { id: uid(), ...f }]);
    setShowForm(false); setEditing(null);
  }
  function remove(id) {
    if (data.tickets.some(t => t.categoryId === id)) { alert("Esta categoria possui demandas vinculadas e não pode ser excluída."); return; }
    update("categories", data.categories.filter(c => c.id !== id));
  }
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: "var(--muted)" }}>Tipos de intervenção que os gestores podem abrir.</p>
        <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={14} /> Nova categoria</Button>
      </div>
      <div className="flex flex-col gap-2">
        {data.categories.map(c => (
          <div key={c.id} className="rounded-xl p-3.5 flex items-center gap-3" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderLeft: `3px solid ${c.color}` }}>
            <span className="text-lg">{c.icon}</span>
            <div className="flex-1"><p className="text-sm font-semibold" style={{ color: "var(--ink)" }}>{c.name}</p><p className="text-xs" style={{ color: "var(--faint)" }}>Prazo padrão de atendimento: {c.slaHours}h</p></div>
            <div className="flex gap-1"><IconBtn onClick={() => { setEditing(c); setShowForm(true); }}><Pencil size={15} /></IconBtn><IconBtn onClick={() => remove(c.id)}><Trash2 size={15} /></IconBtn></div>
          </div>
        ))}
      </div>
      {showForm && <CategoryFormModal initial={editing} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={save} />}
    </>
  );
}
function CategoryFormModal({ initial, onCancel, onSave }) {
  const [f, setF] = useState(initial || { name: "", icon: "🔧", color: "#0E6E5D", slaHours: 48 });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal title={initial ? "Editar categoria" : "Nova categoria"} onClose={onCancel}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-4 gap-3">
          <Field label="Ícone"><TextInput value={f.icon} onChange={e => set("icon", e.target.value)} /></Field>
          <div className="col-span-3"><Field label="Nome"><TextInput value={f.name} onChange={e => set("name", e.target.value)} /></Field></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cor"><TextInput type="color" value={f.color} onChange={e => set("color", e.target.value)} style={{ padding: 3, height: 38 }} /></Field>
          <Field label="Prazo de atendimento (horas)" hint="Usado para calcular automaticamente o prazo das demandas abertas nesta categoria."><TextInput type="number" value={f.slaHours} onChange={e => set("slaHours", Number(e.target.value))} /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-2"><Button variant="outline" onClick={onCancel}>Cancelar</Button><Button onClick={() => onSave(f)} disabled={!f.name.trim()}>Salvar</Button></div>
      </div>
    </Modal>
  );
}

function UsersView({ data, update }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  function save(f) {
    if (editing) update("users", data.users.map(u => u.id === editing.id ? { ...u, ...f } : u));
    else update("users", [...data.users, { id: uid(), ...f }]);
    setShowForm(false); setEditing(null);
  }
  function remove(id) {
    const u = data.users.find(x => x.id === id);
    if (u?.role === "admin" && data.users.filter(x => x.role === "admin").length <= 1) { alert("Deve existir ao menos um usuário administrador."); return; }
    update("users", data.users.filter(u => u.id !== id));
  }
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: "var(--muted)" }}>{data.users.length} usuários cadastrados para acessar o sistema.</p>
        <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={14} /> Novo usuário</Button>
      </div>
      <div className="flex flex-col gap-2">
        {data.users.map(u => (
          <div key={u.id} className="rounded-xl p-3.5 flex items-center gap-3" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}>
            <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={{ backgroundColor: "var(--accent-soft)", color: "var(--accent-ink)" }}>{u.name.split(" ").map(n => n[0]).slice(0, 2).join("")}</div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-sm font-semibold truncate" style={{ color: "var(--ink)" }}>{u.name}</p>
                <Pill label={ROLES.find(r => r.id === u.role)?.label} color="var(--accent)" soft="var(--accent-soft)" />
              </div>
              <p className="text-xs truncate mt-0.5" style={{ color: "var(--faint)" }}>
                <strong>Login:</strong> {u.email} · <strong>Senha:</strong> <span className="font-mono text-gray-700 bg-gray-100 px-1 py-0.5 rounded">{u.password || "123"}</span> · {u.role === "admin" ? "Acesso total" : (data.stores.find(s => s.id === u.storeId)?.name || "Sem loja vinculada")}
              </p>
            </div>
            <div className="flex gap-1"><IconBtn onClick={() => { setEditing(u); setShowForm(true); }} title="Editar dados e senha"><Pencil size={15} /></IconBtn><IconBtn onClick={() => remove(u.id)} title="Excluir usuário"><Trash2 size={15} /></IconBtn></div>
          </div>
        ))}
      </div>
      {showForm && <UserFormModal initial={editing} stores={data.stores} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={save} />}
    </>
  );
}

function UserFormModal({ initial, stores, onCancel, onSave }) {
  const [f, setF] = useState(initial ? {
    name: initial.name,
    email: initial.email,
    password: initial.password || "123",
    role: initial.role,
    storeId: initial.storeId || ""
  } : {
    name: "",
    email: "",
    password: "123",
    role: "loja",
    storeId: stores[0]?.id || ""
  });
  const [showPass, setShowPass] = useState(false);
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  return (
    <Modal title={initial ? "Editar usuário" : "Novo usuário"} onClose={onCancel}>
      <div className="flex flex-col gap-3">
        <Field label="Nome completo"><TextInput value={f.name} onChange={e => set("name", e.target.value)} placeholder="Ex: Carlos Mendes" /></Field>
        <Field label="E-mail de acesso (Login)"><TextInput type="email" value={f.email} onChange={e => set("email", e.target.value)} placeholder="ex: loja1@empresa.com" /></Field>
        <Field label="Senha de acesso" hint="Senha usada por este usuário para entrar na Central de Demandas.">
          <div className="relative">
            <TextInput
              type={showPass ? "text" : "password"}
              value={f.password}
              onChange={e => set("password", e.target.value)}
              placeholder="Digite a senha"
            />
            <button
              type="button"
              onClick={() => setShowPass(!showPass)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
            >
              {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </Field>
        <Field label="Perfil de acesso">
          <Select value={f.role} onChange={e => set("role", e.target.value)}>
            {ROLES.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
          </Select>
        </Field>
        {f.role === "loja" && (
          <Field label="Loja vinculada" hint="O usuário só terá acesso às demandas, alertas e dados desta loja.">
            <Select value={f.storeId} onChange={e => set("storeId", e.target.value)}>
              <option value="">Selecione uma loja</option>
              {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        )}
        <div className="flex justify-end gap-2 mt-2">
          <Button variant="outline" onClick={onCancel}>Cancelar</Button>
          <Button onClick={() => onSave(f)} disabled={!f.name.trim() || !f.email.trim() || !f.password?.trim() || (f.role === "loja" && !f.storeId)}>Salvar</Button>
        </div>
      </div>
    </Modal>
  );
}

function StatusesView({ data, update }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  function save(f) {
    const payload = { ...f, soft: lighten(f.color) };
    if (editing) update("statuses", data.statuses.map(s => s.id === editing.id ? { ...s, ...payload } : s));
    else update("statuses", [...data.statuses, { id: uid(), ...payload }]);
    setShowForm(false); setEditing(null);
  }
  function remove(id) {
    if (data.statuses.length <= 1) { alert("É necessário manter ao menos um status."); return; }
    if (data.tickets.some(t => t.status === id)) { alert("Este status está em uso por demandas e não pode ser excluído."); return; }
    update("statuses", data.statuses.filter(s => s.id !== id));
  }
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: "var(--muted)" }}>Etapas do fluxo de atendimento das demandas.</p>
        <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={14} /> Novo status</Button>
      </div>
      <div className="flex flex-col gap-2">
        {sortedStatuses(data).map(s => (
          <div key={s.id} className="rounded-xl p-3.5 flex items-center gap-3" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderLeft: `3px solid ${s.color}` }}>
            <Pill label={s.label} color={s.color} soft={s.soft} />
            <p className="text-xs flex-1" style={{ color: "var(--faint)" }}>{s.closed ? "Conta como concluído/fechado" : "Conta como demanda aberta"} · ordem {s.order ?? "—"}</p>
            <div className="flex gap-1"><IconBtn onClick={() => { setEditing(s); setShowForm(true); }}><Pencil size={15} /></IconBtn><IconBtn onClick={() => remove(s.id)}><Trash2 size={15} /></IconBtn></div>
          </div>
        ))}
      </div>
      {showForm && <StatusFormModal initial={editing} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={save} />}
    </>
  );
}
function StatusFormModal({ initial, onCancel, onSave }) {
  const [f, setF] = useState(initial ? { label: initial.label, color: initial.color, closed: initial.closed, order: initial.order ?? 10 } : { label: "", color: "#2255C9", closed: false, order: 10 });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal title={initial ? "Editar status" : "Novo status"} onClose={onCancel}>
      <div className="flex flex-col gap-3">
        <Field label="Nome"><TextInput value={f.label} onChange={e => set("label", e.target.value)} placeholder="Ex: Em análise" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cor"><TextInput type="color" value={f.color} onChange={e => set("color", e.target.value)} style={{ padding: 3, height: 38 }} /></Field>
          <Field label="Ordem de exibição" hint="Define a posição nas listas e filtros."><TextInput type="number" value={f.order} onChange={e => set("order", Number(e.target.value))} /></Field>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.closed} onChange={e => set("closed", e.target.checked)} /> Conta como demanda concluída/fechada</label>
        <div className="flex justify-end gap-2 mt-2"><Button variant="outline" onClick={onCancel}>Cancelar</Button><Button onClick={() => onSave(f)} disabled={!f.label.trim()}>Salvar</Button></div>
      </div>
    </Modal>
  );
}

function PrioritiesView({ data, update }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  function save(f) {
    const payload = { ...f, soft: lighten(f.color) };
    if (editing) update("priorities", data.priorities.map(p => p.id === editing.id ? { ...p, ...payload } : p));
    else update("priorities", [...data.priorities, { id: uid(), ...payload }]);
    setShowForm(false); setEditing(null);
  }
  function remove(id) {
    if (data.priorities.length <= 1) { alert("É necessário manter ao menos uma prioridade."); return; }
    if (data.tickets.some(t => t.priority === id)) { alert("Esta prioridade está em uso por demandas e não pode ser excluída."); return; }
    update("priorities", data.priorities.filter(p => p.id !== id));
  }
  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm" style={{ color: "var(--muted)" }}>Níveis de urgência usados nas demandas. Peso maior = mais crítico.</p>
        <Button size="sm" onClick={() => { setEditing(null); setShowForm(true); }}><Plus size={14} /> Nova prioridade</Button>
      </div>
      <div className="flex flex-col gap-2">
        {sortedPriorities(data).map(p => (
          <div key={p.id} className="rounded-xl p-3.5 flex items-center gap-3" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)", borderLeft: `3px solid ${p.color}` }}>
            <Pill label={p.label} color={p.color} soft={p.soft} />
            <p className="text-xs flex-1" style={{ color: "var(--faint)" }}>peso {p.weight}</p>
            <div className="flex gap-1"><IconBtn onClick={() => { setEditing(p); setShowForm(true); }}><Pencil size={15} /></IconBtn><IconBtn onClick={() => remove(p.id)}><Trash2 size={15} /></IconBtn></div>
          </div>
        ))}
      </div>
      {showForm && <PriorityFormModal initial={editing} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={save} />}
    </>
  );
}
function PriorityFormModal({ initial, onCancel, onSave }) {
  const [f, setF] = useState(initial ? { label: initial.label, color: initial.color, weight: initial.weight ?? 2 } : { label: "", color: "#B08900", weight: 2 });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  return (
    <Modal title={initial ? "Editar prioridade" : "Nova prioridade"} onClose={onCancel}>
      <div className="flex flex-col gap-3">
        <Field label="Nome"><TextInput value={f.label} onChange={e => set("label", e.target.value)} placeholder="Ex: Crítica" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Cor"><TextInput type="color" value={f.color} onChange={e => set("color", e.target.value)} style={{ padding: 3, height: 38 }} /></Field>
          <Field label="Peso" hint="Maior número = mais urgente."><TextInput type="number" value={f.weight} onChange={e => set("weight", Number(e.target.value))} /></Field>
        </div>
        <div className="flex justify-end gap-2 mt-2"><Button variant="outline" onClick={onCancel}>Cancelar</Button><Button onClick={() => onSave(f)} disabled={!f.label.trim()}>Salvar</Button></div>
      </div>
    </Modal>
  );
}

function ReportsView({ data }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [storeFilter, setStoreFilter] = useState("");

  const filtered = data.tickets.filter(t => {
    const d = t.createdAt ? t.createdAt.slice(0, 10) : null;
    if (!d) return false;
    if (start && d < start) return false;
    if (end && d > end) return false;
    if (storeFilter && t.storeId !== storeFilter) return false;
    return true;
  });
  const closedCount = filtered.filter(t => isClosedStatus(data, t.status)).length;
  const totalBudget = filtered.reduce((sum, t) => sum + (Number(t.budget) || 0), 0);
  const completionRate = filtered.length ? Math.round((closedCount / filtered.length) * 100) : 0;

  const byCategory = data.categories.map(c => ({ id: c.id, label: `${c.icon} ${c.name}`, value: filtered.filter(t => t.categoryId === c.id).length, color: c.color }));
  const maxCat = Math.max(1, ...byCategory.map(c => c.value));
  const byStore = data.stores.map(s => ({ id: s.id, label: s.name, value: filtered.filter(t => t.storeId === s.id).length, color: "#0E6E5D" }));
  const maxStore = Math.max(1, ...byStore.map(s => s.value));
  const byStatus = sortedStatuses(data).map(s => ({ id: s.id, label: s.label, value: filtered.filter(t => t.status === s.id).length, color: s.color }));
  const maxStatus = Math.max(1, ...byStatus.map(s => s.value));

  const list = [...filtered].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  function handleExportCSV() {
    const headers = ["OS", "Título", "Descrição", "Loja", "Categoria", "Prioridade", "Status", "Solicitante", "Responsável", "Aberta em", "Prazo", "Orçamento (R$)", "Observação"];
    const rows = list.map(t => {
      const st = findStatus(data, t.status);
      const pr = findPriority(data, t.priority);
      const storeName = data.stores.find(s => s.id === t.storeId)?.name || "";
      const catName = data.categories.find(c => c.id === t.categoryId)?.name || "";
      const requesterName = data.users.find(u => u.id === t.requesterId)?.name || "";
      const assigneeName = data.users.find(u => u.id === t.assigneeId)?.name || "Não definido";
      return [
        osCode(t), t.title, t.description || "", storeName, catName, pr.label, st.label,
        requesterName, assigneeName, fmtDateTime(t.createdAt), fmtDate(t.dueDate),
        t.budget ? Number(t.budget).toFixed(2) : "", t.serviceNotes || "",
      ];
    });
    downloadCSV(`relatorio-demandas-${todayISO()}.csv`, headers, rows);
  }

  return (
    <div className="p-8 max-w-6xl">
      <h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Relatórios</h1>
      <p className="text-sm mt-1 mb-5" style={{ color: "var(--muted)" }}>Panorama gerencial das demandas por período.</p>

      <div className="flex flex-wrap items-end gap-3 mb-6">
        <Field label="De"><TextInput type="date" value={start} onChange={e => setStart(e.target.value)} style={{ width: 150 }} /></Field>
        <Field label="Até"><TextInput type="date" value={end} onChange={e => setEnd(e.target.value)} style={{ width: 150 }} /></Field>
        <Field label="Loja">
          <Select value={storeFilter} onChange={e => setStoreFilter(e.target.value)} style={{ width: 190 }}>
            <option value="">Todas as lojas</option>
            {data.stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        {(start || end || storeFilter) && <button onClick={() => { setStart(""); setEnd(""); setStoreFilter(""); }} className="text-xs font-medium pb-2" style={{ color: "var(--accent)" }}>limpar filtros</button>}
        <Button variant="outline" size="sm" onClick={handleExportCSV} className="ml-auto"><Download size={14} /> Exportar CSV</Button>
      </div>

      <div className="flex gap-4 flex-wrap mb-6">
        <KpiCard label="Demandas no período" value={filtered.length} />
        <KpiCard label="Concluídas" value={closedCount} tone="var(--ok)" />
        <KpiCard label="Taxa de conclusão" value={`${completionRate}%`} />
        <KpiCard label="Gasto total (R$)" value={totalBudget.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <PanelBar title="Demandas por categoria" items={byCategory} max={maxCat} empty="Sem dados no período." />
        <PanelBar title="Demandas por loja" items={byStore} max={maxStore} empty="Sem dados no período." />
      </div>
      <div className="mb-6">
        <PanelBar title="Demandas por status" items={byStatus} max={maxStatus} empty="Sem dados no período." />
      </div>

      <div className="rounded-xl p-5" style={{ backgroundColor: "var(--surface)", border: "1px solid var(--border)" }}>
        <p className="text-sm font-semibold mb-3" style={{ color: "var(--ink)" }}>Demandas no período ({list.length})</p>
        {list.length === 0 ? <p className="text-xs" style={{ color: "var(--faint)" }}>Nenhuma demanda no período selecionado.</p> : (
          <div className="flex flex-col max-h-96 overflow-y-auto">
            {list.map(t => {
              const st = findStatus(data, t.status);
              const store = data.stores.find(s => s.id === t.storeId);
              return (
                <div key={t.id} className="flex items-center gap-3 py-2 text-xs" style={{ borderTop: "1px solid var(--border)" }}>
                  <span style={{ fontFamily: "var(--font-mono)", color: "var(--faint)", width: 100 }} className="shrink-0">{osCode(t)}</span>
                  <span className="flex-1 min-w-0 truncate" style={{ color: "var(--ink)" }}>{t.title}</span>
                  <span style={{ color: "var(--muted)", width: 130 }} className="shrink-0 truncate">{store?.name}</span>
                  <Pill label={st.label} color={st.color} soft={st.soft} />
                  <span style={{ color: "var(--muted)", width: 80 }} className="shrink-0 text-right">{t.budget ? `R$ ${Number(t.budget).toFixed(2)}` : "—"}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AdminView({ data, update }) {
  const [tab, setTab] = useState("usuarios");
  const tabs = [
    { id: "usuarios", label: "Usuários", icon: Users },
    { id: "lojas", label: "Lojas", icon: Building2 },
    { id: "categorias", label: "Categorias", icon: Tag },
    { id: "status", label: "Status", icon: SlidersHorizontal },
    { id: "prioridades", label: "Prioridades", icon: Flag },
  ];
  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-center gap-2 mb-1"><Shield size={18} color="var(--accent)" /><h1 className="text-xl font-bold" style={{ color: "var(--ink)" }}>Administração</h1></div>
      <p className="text-sm mb-5" style={{ color: "var(--muted)" }}>Área restrita a usuários master: usuários, lojas, categorias, status e prioridades.</p>
      <div className="flex gap-1 mb-6 flex-wrap" style={{ borderBottom: "1px solid var(--border)" }}>
        {tabs.map(t => {
          const Icon = t.icon; const active = tab === t.id;
          return (
            <button key={t.id} onClick={() => setTab(t.id)} className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium"
              style={{ color: active ? "var(--accent)" : "var(--muted)", borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent" }}>
              <Icon size={14} />{t.label}
            </button>
          );
        })}
      </div>
      {tab === "usuarios" && <UsersView data={data} update={update} />}
      {tab === "lojas" && <StoresView data={data} update={update} />}
      {tab === "categorias" && <CategoriesView data={data} update={update} />}
      {tab === "status" && <StatusesView data={data} update={update} />}
      {tab === "prioridades" && <PrioritiesView data={data} update={update} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App                                                                  */
/* ------------------------------------------------------------------ */

export default function App() {
  const { data, ready, update } = useStore();
  const { currentUser, loginUser, logoutUser } = useCurrentUser(ready, data.users);
  const [view, setView] = useState("dashboard");
  const [ticketsNav, setTicketsNav] = useState({ filters: null, openId: null });
  const [loginNotice, setLoginNotice] = useState(null);
  const [sinceLogin, setSinceLogin] = useState(null);
  const loginCheckedRef = React.useRef("");

  const myScopeTickets = useMemo(() => {
    if (!currentUser) return [];
    return currentUser.role === "admin" ? data.tickets : data.tickets.filter(t => t.storeId === currentUser.storeId);
  }, [data, currentUser]);

  const counts = useMemo(() => ({
    open: myScopeTickets.filter(t => !isClosedStatus(data, t.status)).length,
    alerts: data.alerts.filter(a => a.status === "ativo" && daysDiff(a.dueDate) <= 7 && (currentUser?.role === "admin" || a.storeId === currentUser?.storeId)).length,
  }), [data, myScopeTickets, currentUser]);

  useEffect(() => {
    if ((view === "admin" || view === "reports") && ready && currentUser && currentUser.role !== "admin") setView("dashboard");
  }, [view, ready, currentUser]);

  // Ao logar, avisa quantas demandas precisam de atenção
  useEffect(() => {
    if (!ready || !currentUser) return;
    if (loginCheckedRef.current === currentUser.id) return;
    loginCheckedRef.current = currentUser.id;
    (async () => {
      let map = {};
      try { const r = await window.storage.get(LAST_LOGIN_KEY, false); map = r ? JSON.parse(r.value) : {}; } catch { map = {}; }
      const previous = map[currentUser.id];
      setSinceLogin(previous || null);
      if (previous) {
        const scoped = currentUser.role === "admin" ? data.tickets : data.tickets.filter(t => t.storeId === currentUser.storeId);
        const count = scoped.filter(t => !isClosedStatus(data, t.status) && t.updatedAt && t.updatedAt > previous).length;
        if (count > 0) setLoginNotice({ count });
      }
      map[currentUser.id] = new Date().toISOString();
      window.storage.set(LAST_LOGIN_KEY, JSON.stringify(map), false).catch(() => {});
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, currentUser?.id]);

  function handleSidebarNav(id) {
    if (id === "tickets") setTicketsNav({ filters: null, openId: null });
    setView(id);
  }
  function goToTickets(filters, openId) {
    setTicketsNav({ filters: filters || {}, openId: openId || null });
    setView("tickets");
  }
  function goToAlerts() { setView("alerts"); }

  if (!ready) {
    return (
      <div className="w-full h-screen flex items-center justify-center" style={{ backgroundColor: "var(--bg)" }}>
        <style>{TOKENS}</style>
        <Loader2 className="animate-spin" size={22} color="var(--accent)" />
      </div>
    );
  }

  // Se não estiver logado, exibe a tela de login
  if (!currentUser) {
    return (
      <>
        <style>{TOKENS}</style>
        <LoginScreen
          users={data.users}
          stores={data.stores}
          onLogin={user => loginUser(user)}
          isCloud={isSupabaseConfigured}
        />
      </>
    );
  }

  return (
    <div className="flex w-full" style={{ backgroundColor: "var(--bg)", fontFamily: "var(--font-ui)", minHeight: "100vh" }}>
      <style>{TOKENS}</style>
      <Sidebar
        view={view}
        setView={handleSidebarNav}
        counts={counts}
        currentUser={currentUser}
        stores={data.stores}
        onLogout={logoutUser}
      />
      <div className="flex-1 overflow-y-auto" style={{ maxHeight: "100vh" }}>
        {view === "dashboard" && <Dashboard data={data} currentUser={currentUser} sinceLogin={sinceLogin} onGoTickets={goToTickets} onGoAlerts={goToAlerts} />}
        {view === "tickets" && <TicketsView data={data} update={update} currentUser={currentUser} initialFilters={ticketsNav.filters} initialOpenId={ticketsNav.openId} />}
        {view === "alerts" && <AlertsView data={data} update={update} currentUser={currentUser} />}
        {view === "reports" && currentUser?.role === "admin" && <ReportsView data={data} />}
        {view === "admin" && currentUser?.role === "admin" && <AdminView data={data} update={update} />}
      </div>
      {loginNotice && (
        <Modal title="Bem-vindo de volta" onClose={() => setLoginNotice(null)}>
          <div className="flex items-start gap-3">
            <Info size={20} color="var(--accent)" />
            <p className="text-sm" style={{ color: "var(--ink)" }}>
              Desde seu último acesso, <strong>{loginNotice.count}</strong> {loginNotice.count > 1 ? "demandas precisam" : "demanda precisa"} da sua atenção — abertas ou com novas interações.
            </p>
          </div>
          <div className="flex justify-end mt-4"><Button onClick={() => setLoginNotice(null)}>Entendi</Button></div>
        </Modal>
      )}
    </div>
  );
}
