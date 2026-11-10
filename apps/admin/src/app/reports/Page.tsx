/**
 * @project DomusApp - Admin
 * @file src/app/reports/Page.tsx
 * @description Reportes: indicadores del período (ingresos, morosidad, accesos, alertas, casos y reservas) con
 *              gráficos y exportación del reporte completo a Excel o PDF
 *
 * Cada sección aparece solo si la API la envió, es decir, si el rol puede entrar a su módulo de origen.
 */

import { useState, type ReactNode } from "react";
import { Alert, Badge, Button, Group, Loader, Paper, SegmentedControl, SimpleGrid, Stack, Table, Text, Title, Tooltip } from "@mantine/core";
import { BarChart, DonutChart, LineChart } from "@mantine/charts";
import { DatePickerInput } from "@mantine/dates";
import {
  IconAlarm,
  IconCalendarEvent,
  IconCash,
  IconClipboardList,
  IconDoorEnter,
  IconFileSpreadsheet,
  IconFileTypePdf,
  IconInfoCircle,
  IconRefresh,
  IconReportMoney
} from "@tabler/icons-react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useNavigate } from "react-router-dom";
import { apiDownload, apiGet } from "@clients/apiClient";
import ModuleHeader from "@atoms/layouts/ModuleHeader";
import { useCan } from "@modules/access-control/useCan";
import { fmtDateTime } from "@utils/format";
import { notifyError } from "@utils/notify";
import { fmtDay, useMoney } from "@/app/finance/shared";
import { duration, PALETTE, PRESETS, type Indicators, type PresetKey } from "./shared";

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "—" : `${new Intl.NumberFormat("es-419", { maximumFractionDigits: 1 }).format(v * 100)} %`);
const int = (v: number | null | undefined) => (v === null || v === undefined ? "—" : new Intl.NumberFormat("es-419").format(v));
const compact = new Intl.NumberFormat("es-419", { notation: "compact", maximumFractionDigits: 1 });

function Kpi({ label, value, hint, color, help }: Readonly<{ label: string; value: string; hint?: string; color?: string; help?: string }>) {
  return (
    <Paper withBorder radius="lg" p="md">
      <Group gap={4} wrap="nowrap">
        <Text size="xs" c="dimmed" lineClamp={1}>
          {label}
        </Text>
        {help && (
          <Tooltip label={help} multiline w={260} withArrow>
            <IconInfoCircle size={13} className="text-gray-400 shrink-0" />
          </Tooltip>
        )}
      </Group>
      <Text fw={700} size="xl" c={color} lh={1.3}>
        {value}
      </Text>
      {hint && (
        <Text size="xs" c="dimmed" lineClamp={1}>
          {hint}
        </Text>
      )}
    </Paper>
  );
}

function Section({ title, subtitle, icon: Icon, right, children }: Readonly<{ title: string; subtitle?: string; icon: typeof IconCash; right?: ReactNode; children: ReactNode }>) {
  return (
    <Paper withBorder radius="lg" p="lg">
      <Group justify="space-between" mb="md" align="flex-start">
        <Group gap="sm" align="flex-start">
          <span className="p-2 rounded-xl bg-brand-50 text-brand-700">
            <Icon size={20} />
          </span>
          <div>
            <Title order={4}>{title}</Title>
            {subtitle && (
              <Text size="xs" c="dimmed">
                {subtitle}
              </Text>
            )}
          </div>
        </Group>
        {right}
      </Group>
      <Stack gap="lg">{children}</Stack>
    </Paper>
  );
}

function ChartBox({ title, children, empty }: Readonly<{ title: string; children: ReactNode; empty?: boolean }>) {
  return (
    <div>
      <Text size="sm" fw={600} mb={6}>
        {title}
      </Text>
      {empty ? (
        <Text size="sm" c="dimmed" py="md">
          Sin movimientos en el período.
        </Text>
      ) : (
        children
      )}
    </div>
  );
}

/** Lista con barra proporcional (rankings y repartos) */
function Bars({ rows, format }: Readonly<{ rows: { label: string; value: number; extra?: string }[]; format: (v: number) => string }>) {
  if (rows.length === 0) {
    return (
      <Text size="sm" c="dimmed">
        Sin movimientos en el período.
      </Text>
    );
  }
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <Stack gap={8}>
      {rows.map((r) => (
        <div key={r.label}>
          <Group justify="space-between" gap="xs" wrap="nowrap">
            <Text size="sm" lineClamp={1}>
              {r.label}
            </Text>
            <Text size="sm" fw={600} className="shrink-0">
              {format(r.value)}
              {r.extra && (
                <Text span size="xs" c="dimmed" fw={400}>
                  {" "}
                  · {r.extra}
                </Text>
              )}
            </Text>
          </Group>
          <div className="h-1.5 rounded-full bg-brand-50 mt-1">
            <div className="h-1.5 rounded-full bg-brand-500" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </Stack>
  );
}

function Donut({ rows, format, center }: Readonly<{ rows: { name: string; value: number }[]; format: (v: number) => string; center?: string }>) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  if (total === 0) {
    return (
      <Text size="sm" c="dimmed">
        Sin movimientos en el período.
      </Text>
    );
  }
  return (
    <Group gap="lg" wrap="nowrap" align="center">
      <DonutChart
        size={150}
        thickness={24}
        withTooltip
        tooltipDataSource="segment"
        valueFormatter={format}
        chartLabel={center}
        data={rows.map((r, i) => ({ name: r.name, value: r.value, color: PALETTE[i % PALETTE.length] }))}
      />
      <Stack gap={4}>
        {rows.map((r, i) => (
          <Group key={r.name} gap={6} wrap="nowrap">
            <span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: `var(--mantine-color-${PALETTE[i % PALETTE.length].replace(".", "-")})` }} />
            <Text size="xs">{r.name}</Text>
            <Text size="xs" c="dimmed">
              {format(r.value)} · {pct(r.value / total)}
            </Text>
          </Group>
        ))}
      </Stack>
    </Group>
  );
}

export default function ReportsPage() {
  const navigate = useNavigate();
  const can = useCan("REPORTS");
  const money = useMoney();
  const [preset, setPreset] = useState<PresetKey>("6m");
  const [custom, setCustom] = useState<[string | null, string | null]>([null, null]);
  const [exporting, setExporting] = useState<string | null>(null);

  const range = preset === "custom" ? { from: custom[0], to: custom[1] } : PRESETS.find((p) => p.key === preset)!.range();
  const ready = Boolean(range.from && range.to);

  const q = useQuery({
    queryKey: ["reports", "indicators", range.from, range.to],
    queryFn: () => apiGet<Indicators>("/reports/indicators", { from: range.from!, to: range.to! }),
    enabled: ready,
    placeholderData: keepPreviousData
  });
  const d = q.data;
  const label = (p: string) => (d?.bucket === "month" ? dayjs(p).format("MMM YY") : dayjs(p).format("D MMM"));
  const short = (v: number) => compact.format(v);

  const exportAs = async (format: "xlsx" | "pdf") => {
    if (!ready) return;
    setExporting(format);
    try {
      await apiDownload("/reports/export", { from: range.from!, to: range.to!, format });
    } catch (err) {
      notifyError(err, "No se pudo exportar el reporte");
    } finally {
      setExporting(null);
    }
  };

  const right = can("download") ? (
    <>
      <Button variant="default" leftSection={<IconFileSpreadsheet size={16} />} loading={exporting === "xlsx"} disabled={!d} onClick={() => exportAs("xlsx")}>
        Excel
      </Button>
      <Button variant="default" leftSection={<IconFileTypePdf size={16} />} loading={exporting === "pdf"} disabled={!d} onClick={() => exportAs("pdf")}>
        PDF
      </Button>
    </>
  ) : undefined;

  return (
    <div className="p-6">
      <ModuleHeader title="Reportes" description="Indicadores del condominio en el período: ingresos, morosidad, accesos, alertas, casos y reservas" right={right} />

      <Paper withBorder radius="lg" p="md" mb="lg">
        <Group gap="md" wrap="wrap">
          <SegmentedControl
            value={preset}
            onChange={(v) => setPreset(v as PresetKey)}
            data={[...PRESETS.map((p) => ({ value: p.key, label: p.label })), { value: "custom", label: "Otro período" }]}
          />
          {preset === "custom" && (
            <DatePickerInput
              type="range"
              placeholder="Desde – hasta"
              value={custom}
              onChange={(v) => setCustom([v[0] ? dayjs(v[0]).format("YYYY-MM-DD") : null, v[1] ? dayjs(v[1]).format("YYYY-MM-DD") : null])}
              maxDate={new Date()}
              valueFormat="D MMM YYYY"
              w={260}
              clearable
            />
          )}
          {d && (
            <Group gap={6} ml="auto">
              {q.isFetching ? <Loader size={14} /> : <IconRefresh size={14} className="text-gray-400" />}
              <Text size="xs" c="dimmed">
                Del {fmtDay(d.from)} al {fmtDay(d.to)} · {d.days} días · agrupado por {d.bucket === "month" ? "mes" : "día"} · calculado {fmtDateTime(d.generatedAt)}
              </Text>
            </Group>
          )}
        </Group>
      </Paper>

      {!ready && (
        <Alert color="gray" variant="light">
          Elija la fecha inicial y la final del período.
        </Alert>
      )}
      {q.isLoading && (
        <Group justify="center" py="xl">
          <Loader />
        </Group>
      )}
      {q.isError && (
        <Alert color="red" variant="light">
          {(q.error as Error).message}
        </Alert>
      )}
      {d && d.sections.length === 0 && (
        <Alert color="gray" variant="light">
          Su rol no tiene acceso a ningún módulo con indicadores (Finanzas, Control de acceso, Alertas, Casos o Reservaciones).
        </Alert>
      )}

      {d && (
        <Stack gap="lg">
          {d.finance && (
            <Section title="Ingresos y gastos" subtitle={`Montos en ${d.currency.code}`} icon={IconCash} right={<Button variant="subtle" size="xs" onClick={() => navigate("/finance")}>Ir a Finanzas</Button>}>
              <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
                <Kpi label="Facturado" value={money(d.finance.billed)} hint="cuotas y cargos que vencen" />
                <Kpi label="Cobrado" value={money(d.finance.collected)} hint={`${int(d.finance.payments)} pagos aprobados`} color="teal" />
                <Kpi
                  label="Cobranza"
                  value={pct(d.finance.collectionRate)}
                  help="Cobrado ÷ facturado en el período. Puede pasar del 100 % si se cobraron deudas de antes o adelantos."
                  color={d.finance.collectionRate !== null && d.finance.collectionRate < 0.85 ? "orange" : undefined}
                />
                <Kpi label="Gastos" value={money(d.finance.expenses)} hint="facturas registradas" />
                <Kpi label="Resultado" value={money(d.finance.net)} hint="cobrado − gastos" color={d.finance.net < 0 ? "red" : "teal"} />
                <Kpi label="Gasto / cobrado" value={pct(d.finance.collected ? d.finance.expenses / d.finance.collected : null)} hint="de lo que entra" />
              </SimpleGrid>
              <ChartBox title={d.bucket === "month" ? "Facturado, cobrado y gastos por mes" : "Facturado, cobrado y gastos por día"} empty={!d.finance.billed && !d.finance.collected && !d.finance.expenses}>
                <BarChart
                  h={260}
                  data={d.finance.byPeriod.map((p) => ({ ...p, label: label(p.period) }))}
                  dataKey="label"
                  series={[
                    { name: "billed", label: "Facturado", color: "domus.3" },
                    { name: "collected", label: "Cobrado", color: "teal.6" },
                    { name: "expenses", label: "Gastos", color: "orange.5" }
                  ]}
                  withLegend
                  valueFormatter={money}
                  yAxisProps={{ tickFormatter: short, width: 60 }}
                />
              </ChartBox>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
                <ChartBox title="Cobros por medio de pago">
                  <Donut rows={d.finance.byMethod.map((m) => ({ name: m.label, value: m.amount }))} format={money} center={short(d.finance.collected)} />
                </ChartBox>
                <ChartBox title="Gastos por categoría">
                  <Bars rows={d.finance.expensesByCategory.map((c) => ({ label: c.label, value: c.amount, extra: pct(d.finance!.expenses ? c.amount / d.finance!.expenses : null) }))} format={money} />
                </ChartBox>
              </SimpleGrid>
            </Section>
          )}

          {d.delinquency && (
            <Section
              title="Morosidad"
              subtitle={`Situación al ${fmtDay(d.delinquency.asOf)} (no depende del período)`}
              icon={IconReportMoney}
              right={<Button variant="subtle" size="xs" onClick={() => navigate("/finance/balances")}>Ver saldos</Button>}
            >
              <SimpleGrid cols={{ base: 2, sm: 3, lg: 5 }}>
                <Kpi label="Filiales en mora" value={`${int(d.delinquency.delinquent)} de ${int(d.delinquency.units)}`} color={d.delinquency.delinquent ? "red" : "teal"} />
                <Kpi label="Índice de morosidad" value={pct(d.delinquency.delinquencyRate)} help="Filiales con saldo vencido (pasada la gracia) ÷ filiales activas." />
                <Kpi label="Monto vencido" value={money(d.delinquency.overdue)} color={d.delinquency.overdue ? "red" : undefined} />
                <Kpi label="Por cobrar" value={money(d.delinquency.receivable)} hint="vencido y por vencer" />
                <Kpi label="Saldos a favor" value={money(d.delinquency.credit)} hint="adelantos de filiales" />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
                <ChartBox title="Antigüedad de la deuda vencida" empty={!d.delinquency.delinquent}>
                  <BarChart
                    h={220}
                    data={d.delinquency.aging.map((a) => ({ label: a.label, amount: a.amount, units: a.units }))}
                    dataKey="label"
                    series={[{ name: "amount", label: "Vencido", color: "red.5" }]}
                    valueFormatter={money}
                    yAxisProps={{ tickFormatter: short, width: 60 }}
                  />
                </ChartBox>
                <ChartBox title="Filiales con mayor deuda vencida" empty={!d.delinquency.topDebtors.length}>
                  <Table verticalSpacing={6} highlightOnHover>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Filial</Table.Th>
                        <Table.Th className="text-right">Vencido</Table.Th>
                        <Table.Th className="text-right">Atraso</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {d.delinquency.topDebtors.map((t) => (
                        <Table.Tr key={t.unitId}>
                          <Table.Td>{t.unit}</Table.Td>
                          <Table.Td className="text-right font-semibold">{money(t.overdue)}</Table.Td>
                          <Table.Td className="text-right">
                            <Badge variant="light" color={t.days > 60 ? "red" : t.days > 30 ? "orange" : "yellow"}>
                              {t.days} días
                            </Badge>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </ChartBox>
              </SimpleGrid>
            </Section>
          )}

          {d.access && (
            <Section title="Accesos" subtitle="Ingresos registrados en la caseta" icon={IconDoorEnter} right={<Button variant="subtle" size="xs" onClick={() => navigate("/access/log")}>Ver bitácora</Button>}>
              <SimpleGrid cols={{ base: 2, sm: 4, lg: 8 }}>
                <Kpi label="Ingresos" value={int(d.access.entries)} />
                <Kpi label="Visitantes" value={int(d.access.visitors)} hint="no residentes" />
                <Kpi label="Con vehículo" value={int(d.access.vehicles)} />
                <Kpi label="No anunciadas" value={int(d.access.unannounced)} />
                <Kpi label="Rechazados" value={int(d.access.denied)} color={d.access.denied ? "orange" : undefined} />
                <Kpi label="Estadía promedio" value={duration(d.access.avgStayMinutes === null ? null : d.access.avgStayMinutes * 60)} hint="de las visitas" />
                <Kpi label="Hora pico" value={d.access.peakHour === null ? "—" : `${String(d.access.peakHour).padStart(2, "0")}:00`} />
                <Kpi label="Adentro ahora" value={int(d.access.insideNow)} />
              </SimpleGrid>
              <ChartBox title={d.bucket === "month" ? "Ingresos por mes" : "Ingresos por día"} empty={!d.access.entries}>
                <BarChart h={220} data={d.access.byPeriod.map((p) => ({ ...p, label: label(p.period) }))} dataKey="label" series={[{ name: "entries", label: "Ingresos", color: "domus.6" }]} />
              </ChartBox>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
                <ChartBox title="Por hora del día" empty={!d.access.entries}>
                  <BarChart h={200} data={d.access.byHour.map((h) => ({ label: String(h.hour).padStart(2, "0"), count: h.count }))} dataKey="label" series={[{ name: "count", label: "Ingresos", color: "teal.6" }]} />
                </ChartBox>
                <ChartBox title="Por día de la semana" empty={!d.access.entries}>
                  <BarChart h={200} data={d.access.byWeekday.map((w) => ({ label: w.label.slice(0, 3), count: w.count }))} dataKey="label" series={[{ name: "count", label: "Ingresos", color: "grape.5" }]} />
                </ChartBox>
                <ChartBox title="Por tipo de ingreso">
                  <Donut rows={d.access.byKind.map((k) => ({ name: k.label, value: k.count }))} format={int} center={short(d.access.entries)} />
                </ChartBox>
                <ChartBox title="Filiales con más visitas">
                  <Bars rows={d.access.topUnits.map((u) => ({ label: u.unit, value: u.count }))} format={int} />
                </ChartBox>
              </SimpleGrid>
            </Section>
          )}

          {d.alerts && (
            <Section title="Alertas de pánico" subtitle="Tiempos de respuesta de la caseta" icon={IconAlarm} right={<Button variant="subtle" size="xs" onClick={() => navigate("/alerts")}>Ver alertas</Button>}>
              <SimpleGrid cols={{ base: 2, sm: 4, lg: 7 }}>
                <Kpi label="Alertas" value={int(d.alerts.total)} />
                <Kpi label="Sin cerrar" value={int(d.alerts.open)} color={d.alerts.open ? "red" : undefined} />
                <Kpi label="Respuesta promedio" value={duration(d.alerts.avgAckSeconds)} help="Desde que se activa la alerta hasta que un guarda marca «voy en camino»." />
                <Kpi label="Respuesta mediana" value={duration(d.alerts.medianAckSeconds)} help="La mitad de las alertas se respondió en este tiempo o menos." />
                <Kpi label="Más lenta" value={duration(d.alerts.maxAckSeconds)} color={d.alerts.maxAckSeconds && d.alerts.maxAckSeconds > 300 ? "orange" : undefined} />
                <Kpi label="En 5 min o menos" value={pct(d.alerts.ackWithin5)} color={d.alerts.ackWithin5 !== null && d.alerts.ackWithin5 < 0.9 ? "orange" : "teal"} />
                <Kpi label="Cierre promedio" value={duration(d.alerts.avgAttendSeconds)} help="Desde que se activa hasta que se marca como atendida." />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
                <ChartBox title={d.bucket === "month" ? "Alertas por mes" : "Alertas por día"} empty={!d.alerts.total}>
                  <BarChart h={220} data={d.alerts.byPeriod.map((p) => ({ ...p, label: label(p.period) }))} dataKey="label" series={[{ name: "count", label: "Alertas", color: "red.5" }]} />
                </ChartBox>
                <ChartBox title="Respuesta promedio (minutos)" empty={!d.alerts.total}>
                  <LineChart
                    h={220}
                    data={d.alerts.byPeriod.map((p) => ({ label: label(p.period), minutes: p.count ? Math.round((p.avgAckSeconds / 60) * 10) / 10 : null }))}
                    dataKey="label"
                    series={[{ name: "minutes", label: "Minutos", color: "orange.6" }]}
                    connectNulls
                    referenceLines={[{ y: 5, label: "Meta 5 min", color: "gray.5" }]}
                    valueFormatter={(v) => `${v} min`}
                  />
                </ChartBox>
              </SimpleGrid>
              <ChartBox title="Por tipo de emergencia" empty={!d.alerts.byKind.length}>
                <Bars rows={d.alerts.byKind.map((k) => ({ label: k.label, value: k.count, extra: `responde en ${duration(k.avgAckSeconds)}` }))} format={int} />
              </ChartBox>
            </Section>
          )}

          {d.cases && (
            <Section title="Casos e incidentes" subtitle="Daños, quejas, sugerencias y denuncias" icon={IconClipboardList} right={<Button variant="subtle" size="xs" onClick={() => navigate("/cases")}>Ver casos</Button>}>
              <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
                <Kpi label="Abiertos en el período" value={int(d.cases.opened)} />
                <Kpi label="Resueltos en el período" value={int(d.cases.resolved)} color="teal" />
                <Kpi label="Tiempo de solución" value={d.cases.avgResolutionHours === null ? "—" : duration(d.cases.avgResolutionHours * 3600)} hint="promedio" />
                <Kpi label="Calificación" value={d.cases.avgRating === null ? "—" : `${d.cases.avgRating.toFixed(1)} / 5`} hint={`${int(d.cases.ratings)} calificaciones`} />
                <Kpi label="Pendientes hoy" value={int(d.cases.openNow)} />
                <Kpi label="Vencidos hoy" value={int(d.cases.overdueNow)} hint="pasaron la fecha compromiso" color={d.cases.overdueNow ? "orange" : undefined} />
              </SimpleGrid>
              <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
                <ChartBox title="Abiertos y resueltos" empty={!d.cases.opened && !d.cases.resolved}>
                  <BarChart
                    h={220}
                    data={d.cases.byPeriod.map((p) => ({ ...p, label: label(p.period) }))}
                    dataKey="label"
                    series={[
                      { name: "opened", label: "Abiertos", color: "yellow.6" },
                      { name: "resolved", label: "Resueltos", color: "teal.6" }
                    ]}
                    withLegend
                  />
                </ChartBox>
                <ChartBox title="Por categoría">
                  <Bars rows={d.cases.byCategory.map((c) => ({ label: c.label, value: c.count, extra: c.open ? `${c.open} pendientes` : undefined }))} format={int} />
                </ChartBox>
              </SimpleGrid>
              <ChartBox title="Estado actual de los casos del período">
                <Donut rows={d.cases.byStatus.map((s) => ({ name: s.label, value: s.count }))} format={int} center={String(d.cases.opened)} />
              </ChartBox>
            </Section>
          )}

          {d.bookings && (
            <Section title="Reservaciones" subtitle="Reservas de áreas comunes que empiezan en el período" icon={IconCalendarEvent} right={<Button variant="subtle" size="xs" onClick={() => navigate("/bookings")}>Ver reservas</Button>}>
              <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }}>
                <Kpi label="Confirmadas" value={int(d.bookings.approved)} />
                <Kpi label="Horas reservadas" value={int(Math.round(d.bookings.hours * 10) / 10)} />
                <Kpi label="Ingresos" value={money(d.bookings.revenue)} hint="cobros por uso" />
                <Kpi label="Por aprobar" value={int(d.bookings.pending)} color={d.bookings.pending ? "yellow" : undefined} />
                <Kpi label="Canceladas" value={int(d.bookings.cancelled)} />
                <Kpi label="Rechazadas" value={int(d.bookings.rejected)} />
              </SimpleGrid>
              <ChartBox title="Por área común" empty={!d.bookings.byAmenity.length}>
                <Table verticalSpacing={6} highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Área</Table.Th>
                      <Table.Th className="text-right">Confirmadas</Table.Th>
                      <Table.Th className="text-right">Horas</Table.Th>
                      <Table.Th className="text-right">Ingresos</Table.Th>
                      <Table.Th className="text-right">Canceladas o rechazadas</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {d.bookings.byAmenity.map((a) => (
                      <Table.Tr key={a.name}>
                        <Table.Td>{a.name}</Table.Td>
                        <Table.Td className="text-right">{int(a.approved)}</Table.Td>
                        <Table.Td className="text-right">{int(Math.round(a.hours * 10) / 10)}</Table.Td>
                        <Table.Td className="text-right">{money(a.revenue)}</Table.Td>
                        <Table.Td className="text-right">{int(a.cancelled)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </ChartBox>
            </Section>
          )}
        </Stack>
      )}
    </div>
  );
}
