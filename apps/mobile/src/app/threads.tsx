/**
 * @project DomusApp - Mobile
 * @file src/app/threads.tsx
 * @description Mensajería del residente: una conversación con la caseta por cada filial suya
 *              (con una sola filial, el tablero abre directo el chat)
 */

import { View } from "react-native";
import { ScreenHeader } from "@/components/access";
import { ThreadsList } from "@/components/ThreadsList";

export default function ThreadsScreen() {
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Mensajería" />
      <ThreadsList guard={false} />
    </View>
  );
}
