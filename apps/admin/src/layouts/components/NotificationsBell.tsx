/**
 * @project DomusApp - Admin
 * @file src/layouts/components/NotificationsBell.tsx
 * @description Campana del header: contador en vivo, últimos avisos y aviso urgente de alertas de pánico
 */

import { ActionIcon, Button, Divider, Group, Indicator, Popover, ScrollArea, Text, Tooltip, UnstyledButton } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconAlarm, IconBell, IconCar, IconMessage, IconSpeakerphone, IconUrgent } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type ComponentType } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet, apiPost } from "@clients/apiClient";
import { useRealtime } from "@clients/realtime";
import { coreAuth } from "@auth/store/coreAuth";
import { useCanAccess } from "@modules/access-control/useCan";
import { fmtRelative } from "@utils/format";

interface NotificationRow {
  id: string;
  kind: "alert" | "alert_update" | "visit" | "visit_update" | "message" | "announcement";
  title: string;
  body: string | null;
  data: Record<string, string>;
  readAt: string | null;
  createdAt: string;
}

const ICON: Record<NotificationRow["kind"], { icon: ComponentType<{ size?: number; className?: string }>; color: string }> = {
  alert: { icon: IconUrgent, color: "text-red-600" },
  alert_update: { icon: IconAlarm, color: "text-orange-500" },
  visit: { icon: IconCar, color: "text-brand-700" },
  visit_update: { icon: IconCar, color: "text-brand-700" },
  message: { icon: IconMessage, color: "text-teal-600" },
  announcement: { icon: IconSpeakerphone, color: "text-violet-600" }
};

/** Pitido corto con WebAudio (el navegador puede bloquearlo hasta la primera interacción) */
function beep() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.frequency.setValueAtTime(660, ctx.currentTime + 0.25);
    osc.stop(ctx.currentTime + 0.6);
    osc.onended = () => void ctx.close();
  } catch {
    // sin audio: queda el aviso visual
  }
}

export default function NotificationsBell() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canAccess = useCanAccess();
  const condo = coreAuth((s) => s.condominium?.id);
  const [opened, setOpened] = useState(false);

  const list = useQuery({
    queryKey: ["notifications", condo],
    queryFn: () => apiGet<{ rows: NotificationRow[]; unread: number }>("/notifications", { limit: 20 }),
    enabled: Boolean(condo),
    refetchInterval: 120_000
  });
  const unread = list.data?.unread ?? 0;

  useRealtime<{ notification: NotificationRow; unread: number }>("notification", ({ notification, unread: n }) => {
    qc.setQueryData<{ rows: NotificationRow[]; unread: number }>(["notifications", condo], (old) => ({
      rows: [notification, ...(old?.rows ?? [])].slice(0, 20),
      unread: n
    }));
    if (notification.kind === "alert") {
      beep();
      notifications.show({
        id: `alert-${notification.data.alertId}`,
        color: "red",
        title: notification.title,
        message: notification.body ?? "Alerta de pánico activa",
        autoClose: false,
        icon: <IconUrgent size={18} />,
        onClick: () => canAccess("ALERTS") && navigate("/alerts")
      });
    }
    if (notification.kind.startsWith("alert")) void qc.invalidateQueries({ queryKey: ["alerts"] });
    if (notification.kind.startsWith("visit")) void qc.invalidateQueries({ queryKey: ["access"] });
  });

  const open = async (n: NotificationRow) => {
    setOpened(false);
    if (!n.readAt) {
      const r = await apiPost<{ unread: number }>(`/notifications/${n.id}/read`).catch(() => null);
      qc.setQueryData<{ rows: NotificationRow[]; unread: number }>(["notifications", condo], (old) =>
        old ? { rows: old.rows.map((x) => (x.id === n.id ? { ...x, readAt: new Date().toISOString() } : x)), unread: r?.unread ?? old.unread } : old
      );
    }
    if (n.kind.startsWith("alert") && canAccess("ALERTS")) navigate("/alerts");
    else if (n.kind === "announcement" && canAccess("MESSAGES")) navigate("/announcements");
    else if (n.kind.startsWith("visit") && canAccess("ACCESS")) navigate("/access");
  };

  const readAll = async () => {
    await apiPost("/notifications/read-all").catch(() => null);
    void qc.invalidateQueries({ queryKey: ["notifications", condo] });
  };

  return (
    <Popover opened={opened} onChange={setOpened} width={360} position="bottom-end" shadow="md" withinPortal>
      <Popover.Target>
        <Tooltip label="Notificaciones" disabled={opened}>
          <Indicator label={unread > 99 ? "99+" : unread} size={16} color="red" disabled={unread === 0} offset={4}>
            <ActionIcon variant="subtle" color="gray" size="lg" radius="xl" aria-label="Notificaciones" onClick={() => setOpened((o) => !o)}>
              <IconBell size={20} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        <Group justify="space-between" px="md" py="sm">
          <Text fw={600}>Notificaciones</Text>
          {unread > 0 && (
            <Button size="compact-xs" variant="subtle" onClick={readAll}>
              Marcar todo como leído
            </Button>
          )}
        </Group>
        <Divider />
        <ScrollArea.Autosize mah={420}>
          {(list.data?.rows ?? []).length === 0 && (
            <Text size="sm" c="dimmed" ta="center" py="xl">
              Sin notificaciones
            </Text>
          )}
          {list.data?.rows.map((n) => {
            const { icon: Icon, color } = ICON[n.kind] ?? ICON.message;
            return (
              <UnstyledButton key={n.id} onClick={() => open(n)} className={`w-full px-4 py-3 flex gap-3 hover:bg-gray-50 ${n.readAt ? "" : "bg-blue-50/60"}`}>
                <Icon size={20} className={`${color} shrink-0 mt-0.5`} />
                <div className="min-w-0 flex-1">
                  <Text size="sm" fw={n.readAt ? 400 : 600} lineClamp={2}>
                    {n.title}
                  </Text>
                  {n.body && (
                    <Text size="xs" c="dimmed" lineClamp={2}>
                      {n.body}
                    </Text>
                  )}
                  <Text size="xs" c="dimmed" mt={2}>
                    {fmtRelative(n.createdAt)}
                  </Text>
                </div>
              </UnstyledButton>
            );
          })}
        </ScrollArea.Autosize>
      </Popover.Dropdown>
    </Popover>
  );
}
