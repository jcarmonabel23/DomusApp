/**
 * @project DomusApp - Admin
 * @file src/navigation/moduleIcons.ts
 * @description Ícono Tabler de cada módulo según `catalogs_modules.icon`
 */

import type { ComponentType } from "react";
import {
  IconAlarm,
  IconApps,
  IconBuildingCommunity,
  IconCalendarEvent,
  IconCar,
  IconCash,
  IconChartBar,
  IconClipboardList,
  IconFileText,
  IconGavel,
  IconHome,
  IconHomeCog,
  IconPackages,
  IconSettings,
  IconSpeakerphone,
  IconTruckDelivery,
  IconUserShield,
  IconUsers
} from "@tabler/icons-react";

type Icon = ComponentType<{ size?: number; stroke?: number; className?: string }>;

const ICONS: Record<string, Icon> = {
  home: IconHome,
  "building-community": IconBuildingCommunity,
  "home-cog": IconHomeCog,
  users: IconUsers,
  "user-shield": IconUserShield,
  car: IconCar,
  alarm: IconAlarm,
  cash: IconCash,
  "calendar-event": IconCalendarEvent,
  "clipboard-list": IconClipboardList,
  gavel: IconGavel,
  "file-text": IconFileText,
  "truck-delivery": IconTruckDelivery,
  packages: IconPackages,
  "chart-bar": IconChartBar,
  settings: IconSettings,
  speakerphone: IconSpeakerphone
};

export const moduleIcon = (name: string | null): Icon => (name && ICONS[name]) || IconApps;
