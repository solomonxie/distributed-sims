import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRun, type JourneyHop } from '../state/run';
import { useDoc } from '../state/doc';
import { useTheme } from '../theme';
import { Icon } from '../ui/Icon';
import { Card, Mono, Text } from '../ui/primitives';
import { stepLabel } from '../learn/narrate';
import { fmtMs } from '../canvas/SystemCanvas';

/** The followed request's whole life, one numbered step per row; tap a step for its details. */
export function Steps({ onOpen }: { onOpen: (h: JourneyHop) => void }) {
  const { c } = useTheme();
  const doc = useDoc(s => s.doc);
  const lead = useRun(s => s.lead);
  if (!doc || !lead) return <Text color={c.text2}>No request is being followed. Tap Send.</Text>;
  return (
    <Card>
      {lead.hops.slice(0, lead.i + 1).map((h, k) => {
        const now = k === lead.i;
        const past = k < lead.i;
        const tone = h.tcp ? c.warn : h.proto ? c.protocol : h.reply ? (h.ok ? c.ok : c.fail) : h.wait ? c.text2 : c.read;
        return (
          <Pressable key={k} onPress={() => onOpen(h)} style={({ pressed }) => [styles.row, k < lead.hops.length - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.hairlineStrong }, now && { backgroundColor: c.surface2 }, pressed && { opacity: 0.6 }]}>
            <View style={[styles.num, { borderColor: tone, backgroundColor: past ? tone : 'transparent' }]}>
              <Mono style={{ fontSize: 11 }} color={past ? c.canvas : tone}>
                {k + 1}
              </Mono>
            </View>
            <Text numberOfLines={2} style={{ flex: 1, fontWeight: now ? '700' : '400' }} color={past || now ? c.text : c.text2}>
              {stepLabel(doc, h)}
            </Text>
            {h.at !== undefined && (
              <Mono style={{ fontSize: 11 }} color={c.text3}>
                t+{fmtMs(h.at)}
              </Mono>
            )}
            {now ? <Icon name="map-pin" size={14} color={c.accent} /> : <Icon name="chevron-right" size={14} color={c.text3} />}
          </Pressable>
        );
      })}
      {lead.i < lead.hops.length - 1 && (
        <View style={[styles.row, { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.hairlineStrong }]}>
          <View style={[styles.num, { borderColor: c.hairlineStrong }]} />
          <Text color={c.text3} style={{ flex: 1 }}>
            {lead.hops.length - 1 - lead.i} more step{lead.hops.length - 2 - lead.i ? 's' : ''} to come
          </Text>
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  num: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
