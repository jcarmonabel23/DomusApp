/**
 * @project DomusApp - Admin
 * @file src/app/inventory/Page.tsx
 * @description Inventario: indicadores, listado con filtros (estado, categoría, área, mantenimientos), exportes y ficha
 */

import { useMemo, useState } from "react";
import { Avatar, Badge, Button, Group, Paper, SegmentedControl, Select, SimpleGrid, Switch, Text, TextInput } from "@mantine/core";
import { IconFileSpreadsheet, IconFileTypePdf, IconPackage, IconPlus, IconSearch } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ColumnDef } from "@tanstack/react-table";
import { apiDownload, apiGet } from "@clients/apiClient";
import { useRealtime } from "@clients/realtime";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import DataTable from "@atoms/tables/DataTable";
import { useCan } from "@modules/access-control/useCan";
import { notifyError } from "@utils/notify";
import { fmtDay, useMoney } from "@/app/finance/shared";
import { options } from "@/app/suppliers/shared";
import ItemModal from "./ItemModal";
import { CATEGORY, CONDITION, type Item } from "./shared";

interface Summary {
  items: number;
  units: number;
  value: number;
  damaged: number;
  maintenanceDue: number;
  retired: number;
}

export default function InventoryPage() {
  const qc = useQueryClient();
  const can = useCan("INVENTORY");
  const money = useMoney();
  const [active, setActive] = useState("true");
  const [category, setCategory] = useState<string | null>(null);
  const [condition, setCondition] = useState<string | null>(null);
  const [amenityId, setAmenityId] = useState<string | null>(null);
  const [due, setDue] = useState(false);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  useRealtime("inventory:update", () => void qc.invalidateQueries({ queryKey: ["inventory"] }));

  const summary = useQuery({ queryKey: ["inventory", "summary"], queryFn: () => apiGet<Summary>("/inventory/summary") });
  const opts = useQuery({ queryKey: ["inventory", "options"], queryFn: () => apiGet<{ amenities: { id: string; name: string }[] }>("/inventory/options"), staleTime: 60_000 });
  const filters = { active, category, condition, amenityId, maintenance: due ? "due" : null, search: search.trim() || null };
  const list = useQuery({ queryKey: ["inventory", "list", filters], queryFn: () => apiGet<Item[]>("/inventory", filters) });

  const exportAs = async (format: "xlsx" | "pdf") => {
    setExporting(format);
    try {
      await apiDownload("/inventory/export", { ...filters, format });
    } catch (err) {
      notifyError(err, "No se pudo exportar");
    } finally {
      setExporting(null);
    }
  };

  const s = summary.data;
  const cards: [string, string, string, string?][] = [
    ["Bienes", String(s?.items ?? "—"), `${s?.units ?? "—"} unidades`],
    ["Valor", s ? money(s.value) : "—", "cantidad × valor unitario"],
    ["En mal estado", String(s?.damaged ?? "—"), "malos o dañados", s?.damaged ? "orange" : undefined],
    ["Mantenimientos", String(s?.maintenanceDue ?? "—"), "vencidos o en 15 días", s?.maintenanceDue ? "red" : undefined],
    ["De baja", String(s?.retired ?? "—"), "histórico"]
  ];

  const columns = useMemo<ColumnDef<Item, unknown>[]>(
    () => [
      {
        header: "Bien",
        cell: ({ row: { original: i } }) => (
          <Group gap="sm" wrap="nowrap">
            <Avatar src={i.photo?.thumb} radius="sm" size={40}>
              <IconPackage size={20} />
            </Avatar>
            <div>
              <Text size="sm" fw={600}>
                {i.name}
              </Text>
              <Text size="xs" c="dimmed">
                {i.code}
                {i.brand ? ` · ${i.brand}` : ""}
              </Text>
            </div>
          </Group>
        )
      },
      { header: "Categoría", size: 130, cell: ({ row: { original: i } }) => <Text size="sm">{CATEGORY[i.category]}</Text> },
      { header: "Ubicación", cell: ({ row: { original: i } }) => <Text size="sm">{[i.amenityName, i.location].filter(Boolean).join(" · ") || "—"}</Text> },
      { header: "Cant.", size: 60, cell: ({ row: { original: i } }) => <Text size="sm">{i.quantity}</Text> },
      { header: "Valor", size: 120, cell: ({ row: { original: i } }) => <Text size="sm">{i.unitValue != null ? money(i.totalValue) : "—"}</Text> },
      {
        header: "Estado",
        size: 100,
        cell: ({ row: { original: i } }) => (
          <Badge variant="light" color={i.isActive ? CONDITION[i.condition].color : "gray"}>
            {i.isActive ? CONDITION[i.condition].label : "De baja"}
          </Badge>
        )
      },
      {
        header: "Próx. mantenimiento",
        size: 150,
        cell: ({ row: { original: i } }) =>
          i.nextMaintenanceOn ? (
            <Text size="sm" c={i.maintenanceOverdue ? "red" : i.maintenanceDue ? "orange" : undefined} fw={i.maintenanceDue ? 700 : undefined}>
              {fmtDay(i.nextMaintenanceOn)}
              {i.maintenanceOverdue ? " · vencido" : ""}
            </Text>
          ) : (
            <Text size="xs" c="dimmed">
              —
            </Text>
          )
      }
    ],
    [money]
  );

  return (
    <div className="p-6">
      <ModuleHeader title="Inventario" description="Mobiliario, equipos y bienes del condominio, con su estado, ubicación y mantenimientos" />

      <SimpleGrid cols={{ base: 2, md: 5 }} mb="lg">
        {cards.map(([label, value, hint, color]) => (
          <Paper key={label} withBorder radius="lg" p="md">
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <Text fw={700} size="xl" c={color}>
              {summary.isLoading ? "—" : value}
            </Text>
            <Text size="xs" c="dimmed">
              {hint}
            </Text>
          </Paper>
        ))}
      </SimpleGrid>

      <Group mb="md" justify="space-between" align="end">
        <Group align="end">
          <SegmentedControl
            value={active}
            onChange={setActive}
            data={[
              { value: "true", label: "En uso" },
              { value: "false", label: "De baja" },
              { value: "all", label: "Todos" }
            ]}
          />
          <TextInput label="Buscar" placeholder="Nombre, código, serie o marca" leftSection={<IconSearch size={16} />} value={search} onChange={(e) => setSearch(e.currentTarget.value)} w={230} />
          <Select label="Categoría" placeholder="Todas" clearable data={options(CATEGORY)} value={category} onChange={setCategory} w={160} />
          <Select
            label="Estado"
            placeholder="Todos"
            clearable
            data={Object.entries(CONDITION).map(([value, c]) => ({ value, label: c.label }))}
            value={condition}
            onChange={setCondition}
            w={120}
          />
          <Select
            label="Área común"
            placeholder="Todas"
            clearable
            data={(opts.data?.amenities ?? []).map((a) => ({ value: a.id, label: a.name }))}
            value={amenityId}
            onChange={setAmenityId}
            w={170}
          />
          <Switch label="Mantenimiento por vencer" checked={due} onChange={(e) => setDue(e.currentTarget.checked)} mb={6} />
        </Group>
        <Group gap="xs">
          {can("download") && (
            <>
              <Button variant="light" color="teal" leftSection={<IconFileSpreadsheet size={16} />} loading={exporting === "xlsx"} onClick={() => exportAs("xlsx")}>
                Excel
              </Button>
              <Button variant="light" color="red" leftSection={<IconFileTypePdf size={16} />} loading={exporting === "pdf"} onClick={() => exportAs("pdf")}>
                PDF
              </Button>
            </>
          )}
          {can("add_new") && (
            <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen("new")}>
              Nuevo bien
            </Button>
          )}
        </Group>
      </Group>

      <DataTable data={list.data ?? []} columns={columns} loading={list.isLoading} rowKey={(i) => i.id} onRowClick={(i) => setOpen(i.id)} emptyText="No hay bienes con estos filtros" />

      <ItemModal itemId={open} onClose={() => setOpen(null)} onCreated={setOpen} />
    </div>
  );
}
