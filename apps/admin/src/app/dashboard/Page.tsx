/**
 * @project DomusApp - Admin
 * @file src/app/dashboard/Page.tsx
 * @description Tablero: cifras del condominio activo, lo que pide atención hoy y accesos a los módulos de la sesión
 */

import { Badge, Button, Paper, SimpleGrid, Skeleton, Text } from "@mantine/core";
import {
  IconAlarm,
  IconBuildingCommunity,
  IconCalendarEvent,
  IconChartBar,
  IconClipboardList,
  IconDoorEnter,
  IconFileCertificate,
  IconGavel,
  IconHome,
  IconHomeOff,
  IconKey,
  IconReceipt,
  IconReportMoney,
  IconShieldCheck,
  IconTool,
  IconUserShield,
  IconUsers
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import type { ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "@clients/apiClient";
import { coreAuth } from "@auth/store/coreAuth";
import { visibleModules } from "@modules/access-control/moduleTree";
import { moduleIcon } from "@navigation/moduleIcons";
import { KIND_LABEL } from "@utils/labels";
import { fmtDateTime } from "@utils/format";
import { useCanAccess } from "@modules/access-control/useCan";
import { useRealtime } from "@clients/realtime";
import { useMoney } from "@/app/finance/shared";

interface Summary {
  units: number;
  rented: number;
  vacant: number;
  people: number;
  residents: number;
  guards: number;
  admins: number;
  today: Today;
}

interface Today {
  alerts: { open: number } | null;
  access: { entries: number; inside: number; pending: number } | null;
  finance: { pendingPayments: number; pendingAmount: number; delinquent: number; units: number; overdue: number } | null;
  cases: { open: number; overdue: number; urgent: number } | null;
  bookings: { pending: number; today: number } | null;
  suppliers: { expiring: number; expired: number } | null;
  inventory: { due: number; overdue: number } | null;
  assemblies: { next: { id: string; title: string; scheduledAt: string } | null } | null;
}

interface Attention {
  key: string;
  label: string;
  value: string;
  hint: string;
  icon: ComponentType<{ size?: number }>;
  /** red = urgente, orange = pendiente, teal = todo bien, gray = informativo */
  tone: "red" | "orange" | "teal" | "gray";
  path: string;
}

const TONE: Record<Attention["tone"], string> = {
  red: "bg-red-50 text-red-700 border-red-200",
  orange: "bg-amber-50 text-amber-800 border-amber-200",
  teal: "bg-emerald-50 text-emerald-700 border-emerald-200",
  gray: "bg-gray-50 text-gray-700 border-gray-200"
};

function attention(t: Today, money: (v: number) => string): Attention[] {
  const out: Attention[] = [];
  if (t.alerts) {
    out.push({
      key: "alerts",
      label: "Alertas sin cerrar",
      value: String(t.alerts.open),
      hint: t.alerts.open ? "requieren atención" : "ninguna activa",
      icon: IconAlarm,
      tone: t.alerts.open ? "red" : "teal",
      path: "/alerts"
    });
  }
  if (t.access) {
    out.push({
      key: "access",
      label: "Ingresos de hoy",
      value: String(t.access.entries),
      hint: `${t.access.inside} adentro${t.access.pending ? ` · ${t.access.pending} por confirmar` : ""}`,
      icon: IconDoorEnter,
      tone: t.access.pending ? "orange" : "gray",
      path: "/access/log"
    });
  }
  if (t.finance) {
    out.push({
      key: "payments",
      label: "Pagos por revisar",
      value: String(t.finance.pendingPayments),
      hint: t.finance.pendingPayments ? money(t.finance.pendingAmount) : "al día",
      icon: IconReceipt,
      tone: t.finance.pendingPayments ? "orange" : "teal",
      path: "/finance/payments"
    });
    out.push({
      key: "delinquency",
      label: "Filiales en mora",
      value: `${t.finance.delinquent} de ${t.finance.units}`,
      hint: t.finance.delinquent ? `${money(t.finance.overdue)} vencido` : "nadie en mora",
      icon: IconReportMoney,
      tone: t.finance.delinquent ? "red" : "teal",
      path: "/finance/balances"
    });
  }
  if (t.cases) {
    out.push({
      key: "cases",
      label: "Casos pendientes",
      value: String(t.cases.open),
      hint: [t.cases.urgent && `${t.cases.urgent} urgentes`, t.cases.overdue && `${t.cases.overdue} vencidos`].filter(Boolean).join(" · ") || "sin atrasos",
      icon: IconClipboardList,
      tone: t.cases.urgent || t.cases.overdue ? "orange" : "gray",
      path: "/cases"
    });
  }
  if (t.bookings) {
    out.push({
      key: "bookings",
      label: "Reservas por aprobar",
      value: String(t.bookings.pending),
      hint: `${t.bookings.today} reservas hoy`,
      icon: IconCalendarEvent,
      tone: t.bookings.pending ? "orange" : "gray",
      path: "/bookings/list"
    });
  }
  if (t.suppliers && (t.suppliers.expiring || t.suppliers.expired)) {
    out.push({
      key: "contracts",
      label: "Contratos por vencer",
      value: String(t.suppliers.expiring),
      hint: t.suppliers.expired ? `${t.suppliers.expired} vencieron este mes` : "en los próximos 30 días",
      icon: IconFileCertificate,
      tone: t.suppliers.expired ? "red" : "orange",
      path: "/suppliers"
    });
  }
  if (t.inventory?.due) {
    out.push({
      key: "inventory",
      label: "Mantenimientos próximos",
      value: String(t.inventory.due),
      hint: t.inventory.overdue ? `${t.inventory.overdue} atrasados` : "en los próximos 15 días",
      icon: IconTool,
      tone: t.inventory.overdue ? "red" : "orange",
      path: "/inventory"
    });
  }
  if (t.assemblies?.next) {
    out.push({
      key: "assembly",
      label: "Próxima asamblea",
      value: fmtDateTime(t.assemblies.next.scheduledAt),
      hint: t.assemblies.next.title,
      icon: IconGavel,
      tone: "gray",
      path: "/assemblies"
    });
  }
  return out;
}

function Stat({ label, value, icon: Icon, loading }: Readonly<{ label: string; value?: number; icon: ComponentType<{ size?: number }>; loading: boolean }>) {
  return (
    <Paper withBorder radius="lg" p="md" className="flex items-center gap-3">
      <span className="p-2.5 rounded-xl bg-brand-50 text-brand-700">
        <Icon size={22} />
      </span>
      <div>
        {loading ? <Skeleton h={22} w={40} /> : <Text fw={700} size="xl" lh={1.1}>{value ?? 0}</Text>}
        <Text size="xs" c="dimmed">
          {label}
        </Text>
      </div>
    </Paper>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const user = coreAuth((s) => s.user);
  const condominium = coreAuth((s) => s.condominium);
  const modules = coreAuth((s) => s.modules);
  const canAccess = useCanAccess();
  const money = useMoney();

  const summary = useQuery({
    queryKey: ["dashboard", "summary", condominium?.id],
    queryFn: () => apiGet<Summary>("/dashboard/summary"),
    enabled: Boolean(condominium),
    refetchInterval: 60_000
  });
  // Lo urgente se refresca en cuanto cambia
  const refresh = () => void summary.refetch();
  useRealtime("alert:new", refresh);
  useRealtime("alert:update", refresh);
  useRealtime("access:update", refresh);
  useRealtime("bookings:update", refresh);
  useRealtime("finance:update", refresh);
  useRealtime("cases:update", refresh);
  const items = summary.data?.today ? attention(summary.data.today, money) : [];

  const firstName = user?.names.split(" ")[0] ?? "";
  const cards = visibleModules(modules);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-bold text-gray-900">Hola, {firstName}</h1>
        {condominium ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-gray-500">
            <span className="font-semibold text-gray-700">{condominium.name}</span>
            <Badge variant="light">{KIND_LABEL[condominium.kind] ?? condominium.kind}</Badge>
            <Badge variant="light" color="gray">
              {condominium.country.name} · {condominium.currency.code}
            </Badge>
            <Badge variant="light" color="teal">
              {condominium.roleName}
            </Badge>
          </div>
        ) : (
          <Paper withBorder radius="lg" p="lg" className="flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
            <div>
              <Text fw={600}>Aún no hay condominios activos</Text>
              <Text size="sm" c="dimmed">
                Como administrador de plataforma, registre el primer condominio y designe a su administrador.
              </Text>
            </div>
            <Button leftSection={<IconBuildingCommunity size={16} />} onClick={() => navigate("/condominiums")}>
              Ir a Condominios
            </Button>
          </Paper>
        )}
      </header>

      {condominium && (
        <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
          <Stat label="Filiales" value={summary.data?.units} icon={IconHome} loading={summary.isLoading} />
          <Stat label="Alquiladas" value={summary.data?.rented} icon={IconKey} loading={summary.isLoading} />
          <Stat label="Desocupadas" value={summary.data?.vacant} icon={IconHomeOff} loading={summary.isLoading} />
          <Stat label="Personas" value={summary.data?.people} icon={IconUsers} loading={summary.isLoading} />
          <Stat label="Residentes con app" value={summary.data?.residents} icon={IconUserShield} loading={summary.isLoading} />
          <Stat label="Guardas" value={summary.data?.guards} icon={IconShieldCheck} loading={summary.isLoading} />
        </SimpleGrid>
      )}

      {condominium && items.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide">Hoy</h2>
            {canAccess("REPORTS") && (
              <Button variant="subtle" size="xs" leftSection={<IconChartBar size={14} />} onClick={() => navigate("/reports")}>
                Ver reportes
              </Button>
            )}
          </div>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {items.map((it) => (
              <button
                key={it.key}
                type="button"
                onClick={() => navigate(it.path)}
                className={`text-left rounded-xl border p-4 transition-shadow hover:shadow-md ${TONE[it.tone]}`}
              >
                <div className="flex items-center gap-2 text-xs font-semibold opacity-80">
                  <it.icon size={16} />
                  <span className="truncate">{it.label}</span>
                </div>
                <div className="mt-1 text-2xl font-bold truncate">{it.value}</div>
                <div className="text-xs opacity-80 truncate">{it.hint}</div>
              </button>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wide mb-4">Módulos</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map(({ module: m, enabled }) => {
            const Icon = moduleIcon(m.icon);
            return (
              <button
                key={m.code}
                type="button"
                disabled={!enabled}
                onClick={() => navigate(m.path)}
                className={`text-left bg-white rounded-xl border border-gray-200 p-5 shadow-sm transition-all ${
                  enabled ? "hover:border-brand-200 hover:shadow-md" : "opacity-60 cursor-not-allowed"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <span className={`p-2.5 rounded-xl ${enabled ? "bg-brand-50 text-brand-700" : "bg-gray-100 text-gray-400"}`}>
                    <Icon size={24} stroke={1.6} />
                  </span>
                  {!enabled && (
                    <Badge variant="light" color="gray">
                      Fase {m.phase}
                    </Badge>
                  )}
                </div>
                <h3 className="mt-4 font-bold text-gray-900">{m.name}</h3>
                <p className="mt-1 text-sm text-gray-500">{m.description}</p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
