/**
 * @project DomusApp - Admin
 * @file src/app/finance/BalancesTab.tsx
 * @description Saldos por filial y reporte de morosidad (exportable); un clic abre el estado de cuenta
 */

import { useMemo, useState } from "react";
import { Badge, Button, Group, SegmentedControl, Text, TextInput } from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import { IconFileSpreadsheet, IconFileTypePdf, IconSearch } from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiDownload, apiGet } from "@clients/apiClient";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { notifyError } from "@utils/notify";
import StatementDrawer from "./StatementDrawer";
import { fmtDay, useMoney, type Balance } from "./shared";

const daysSince = (d: string | null) => (d ? Math.max(0, Math.floor((Date.now() - new Date(`${d}T12:00:00`).getTime()) / 86_400_000)) : 0);

export default function BalancesTab() {
  const money = useMoney();
  const can = useCan("FINANCE");
  const [only, setOnly] = useState<"all" | "debt" | "overdue">("overdue");
  const [search, setSearch] = useState("");
  const [q] = useDebouncedValue(search, 250);
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const filters = { only: only === "all" ? undefined : only, q: q || undefined };
  const list = useQuery({
    queryKey: ["finance", "balances", filters],
    queryFn: () => apiGet<{ rows: Balance[]; graceDays: number }>("/finance/balances", filters),
    placeholderData: keepPreviousData
  });
  const rows = list.data?.rows ?? [];
  const totalOverdue = rows.reduce((s, b) => s + b.overdue, 0);

  const exportAs = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    try {
      await apiDownload("/finance/balances/export", { ...filters, format });
    } catch (err) {
      notifyError(err, "No se pudo exportar");
    } finally {
      setExporting(null);
    }
  };

  const columns = useMemo<ColumnDef<Balance, unknown>[]>(
    () => [
      {
        header: "Filial",
        size: 110,
        cell: ({ row: { original: b } }) => (
          <div>
            <Text size="sm" fw={600}>
              {b.unitCode}
            </Text>
            <Text size="xs" c="dimmed">
              {b.unitTower ?? ""}
            </Text>
          </div>
        )
      },
      {
        header: "Responsable de pago",
        cell: ({ row: { original: b } }) =>
          b.payer ? (
            <div>
              <Text size="sm">{b.payer.names}</Text>
              <Text size="xs" c="dimmed">
                {[b.payer.phone, b.payer.email].filter(Boolean).join(" · ")}
              </Text>
            </div>
          ) : (
            <Text size="sm" c="dimmed">
              Sin responsable
            </Text>
          )
      },
      {
        header: "Saldo",
        cell: ({ row: { original: b } }) => (
          <Text size="sm" fw={600} c={b.balance > 0 ? undefined : "teal"}>
            {b.balance < 0 ? `${money(-b.balance)} a favor` : money(b.balance)}
          </Text>
        )
      },
      {
        header: "Vencido",
        cell: ({ row: { original: b } }) => (
          <Text size="sm" fw={600} c={b.overdue > 0 ? "red" : "dimmed"}>
            {b.overdue > 0 ? money(b.overdue) : "—"}
          </Text>
        )
      },
      {
        header: "Antigüedad",
        cell: ({ row: { original: b } }) => {
          if (b.overdue <= 0) return <Badge color="teal" variant="light">Al día</Badge>;
          const days = daysSince(b.oldestDue);
          return (
            <div>
              <Badge color={days > 90 ? "red" : days > 30 ? "orange" : "yellow"} variant="light">
                {days} días
              </Badge>
              <Text size="xs" c="dimmed">
                desde {fmtDay(b.oldestDue)}
              </Text>
            </div>
          );
        }
      },
      {
        header: "En revisión",
        cell: ({ row: { original: b } }) => (b.pending > 0 ? <Badge color="yellow" variant="light">{money(b.pending)}</Badge> : null)
      }
    ],
    [money]
  );

  return (
    <>
      <Group mb="md" justify="space-between" align="end">
        <Group align="end">
          <SegmentedControl
            value={only}
            onChange={(v) => setOnly(v as typeof only)}
            data={[
              { value: "overdue", label: "En mora" },
              { value: "debt", label: "Con saldo" },
              { value: "all", label: "Todas" }
            ]}
          />
          <TextInput placeholder="Filial o torre" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={200} />
          <Text size="sm" c="dimmed">
            {rows.length} filial(es){only === "overdue" && ` · vencido ${money(totalOverdue)} · gracia ${list.data?.graceDays ?? 0} día(s)`}
          </Text>
        </Group>
        {can("download") && (
          <Group gap="xs">
            <Button variant="light" color="teal" leftSection={<IconFileSpreadsheet size={16} />} loading={exporting === "xlsx"} onClick={() => exportAs("xlsx")}>
              Excel
            </Button>
            <Button variant="light" color="red" leftSection={<IconFileTypePdf size={16} />} loading={exporting === "pdf"} onClick={() => exportAs("pdf")}>
              PDF
            </Button>
          </Group>
        )}
      </Group>
      <DataTable
        data={rows}
        columns={columns}
        loading={list.isLoading}
        rowKey={(b) => b.unitId}
        onRowClick={(b) => setOpen(b.unitId)}
        emptyText={only === "overdue" ? "Ninguna filial en mora" : "Sin filiales"}
      />
      <StatementDrawer unitId={open} onClose={() => setOpen(null)} />
    </>
  );
}
