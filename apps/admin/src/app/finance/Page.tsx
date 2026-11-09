/**
 * @project DomusApp - Admin
 * @file src/app/finance/Page.tsx
 * @description Cobros y finanzas: indicadores, morosidad, cargos, pagos, cuotas recurrentes, gastos y configuración
 */

import { Badge, Paper, SimpleGrid, Tabs, Text } from "@mantine/core";
import { IconBuildingBank, IconCalendarRepeat, IconCash, IconFileInvoice, IconReceipt, IconReportMoney } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { apiGet } from "@clients/apiClient";
import { useRealtime } from "@clients/realtime";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import BalancesTab from "./BalancesTab";
import ChargesTab from "./ChargesTab";
import ExpensesTab from "./ExpensesTab";
import PaymentsTab from "./PaymentsTab";
import PlansTab from "./PlansTab";
import SettingsTab from "./SettingsTab";
import { periodLabel, useMoney } from "./shared";

interface Summary {
  period: string;
  charged: number;
  collected: number;
  expenses: number;
  pending: number;
  pendingAmount: number;
  receivable: number;
  overdue: number;
  credit: number;
  delinquent: number;
  units: number;
  delinquencyRate: number;
}

const TABS = ["balances", "charges", "payments", "plans", "expenses", "settings"] as const;

export default function FinancePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const money = useMoney();
  const { "*": rest } = useParams();
  const tab = TABS.find((t) => rest?.startsWith(t)) ?? "balances";
  const summary = useQuery({ queryKey: ["finance", "summary"], queryFn: () => apiGet<Summary>("/finance/summary") });
  const s = summary.data;

  // Un pago reportado, aprobado o resuelto por la pasarela refresca el módulo
  useRealtime("finance:update", () => void qc.invalidateQueries({ queryKey: ["finance"] }));

  const cards: [string, string, string?][] = [
    [`Cobrado en ${s ? periodLabel(s.period) : "el mes"}`, money(s?.collected), s ? `de ${money(s.charged)} facturado` : undefined],
    ["Por cobrar", money(s?.receivable), s?.credit ? `${money(s.credit)} en saldos a favor` : undefined],
    ["Vencido", money(s?.overdue), s ? `${s.delinquent} de ${s.units} filiales en mora (${Math.round(s.delinquencyRate * 100)} %)` : undefined],
    ["Comprobantes por revisar", s ? String(s.pending) : "—", s?.pending ? money(s.pendingAmount) : "al día"],
    ["Gastos del mes", money(s?.expenses)]
  ];

  return (
    <div className="p-6">
      <ModuleHeader title="Cobros y finanzas" description="Cuotas, intereses, multas, pagos, estados de cuenta, gastos y morosidad" />

      <SimpleGrid cols={{ base: 2, md: 5 }} mb="lg">
        {cards.map(([label, value, hint]) => (
          <Paper key={label} withBorder radius="lg" p="md">
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text fw={700} size="xl">
              {summary.isLoading ? "—" : value}
            </Text>
            {hint && (
              <Text size="xs" c="dimmed">
                {hint}
              </Text>
            )}
          </Paper>
        ))}
      </SimpleGrid>

      <Tabs value={tab} onChange={(v) => navigate(`/finance/${v}`)} keepMounted={false}>
        <Tabs.List mb="md">
          <Tabs.Tab value="balances" leftSection={<IconReportMoney size={16} />}>
            Saldos y morosidad
          </Tabs.Tab>
          <Tabs.Tab value="charges" leftSection={<IconFileInvoice size={16} />}>
            Cargos
          </Tabs.Tab>
          <Tabs.Tab
            value="payments"
            leftSection={<IconCash size={16} />}
            rightSection={s?.pending ? <Badge size="xs" color="yellow" circle>{s.pending}</Badge> : undefined}
          >
            Pagos
          </Tabs.Tab>
          <Tabs.Tab value="plans" leftSection={<IconCalendarRepeat size={16} />}>
            Cuotas recurrentes
          </Tabs.Tab>
          <Tabs.Tab value="expenses" leftSection={<IconReceipt size={16} />}>
            Gastos
          </Tabs.Tab>
          <Tabs.Tab value="settings" leftSection={<IconBuildingBank size={16} />}>
            Cuentas y parámetros
          </Tabs.Tab>
        </Tabs.List>
        <Tabs.Panel value="balances">
          <BalancesTab />
        </Tabs.Panel>
        <Tabs.Panel value="charges">
          <ChargesTab />
        </Tabs.Panel>
        <Tabs.Panel value="payments">
          <PaymentsTab />
        </Tabs.Panel>
        <Tabs.Panel value="plans">
          <PlansTab />
        </Tabs.Panel>
        <Tabs.Panel value="expenses">
          <ExpensesTab />
        </Tabs.Panel>
        <Tabs.Panel value="settings">
          <SettingsTab />
        </Tabs.Panel>
      </Tabs>
    </div>
  );
}
