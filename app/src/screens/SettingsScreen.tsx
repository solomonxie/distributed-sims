import React from 'react';
import { Alert, Share } from 'react-native';
import { useTheme } from '../theme';
import { Screen } from '../ui/Screen';
import { Card, Row, SectionHeader, Segmented, Toggle } from '../ui/primitives';
import { useSettings } from '../state/settings';
import { useProgress } from '../state/progress';
import { useLibrary } from '../state/library';

const VERSION = '1.0';

export function SettingsScreen() {
  const { c } = useTheme();
  const s = useSettings();
  return (
    <Screen contentStyle={{ paddingTop: 8 }}>
      <SectionHeader title="SIMULATION" />
      <Card>
        <Row title="Traced requests" right={<Segmented options={['20', '50', '200'] as const} value={String(s.traceEvery) as any} labels={{ '20': '1 in 20', '50': '1 in 50', '200': '1 in 200' }} onChange={v => s.set({ traceEvery: Number(v) })} style={{ width: 210 }} />} />
        <Row title="Node labels" right={<Toggle value={s.labels} onChange={v => s.set({ labels: v })} />} />
        <Row title="Particle density" last right={<Segmented options={['low', 'med', 'high'] as const} value={s.particles} onChange={v => s.set({ particles: v })} style={{ width: 190 }} />} />
      </Card>
      <SectionHeader title="APPEARANCE" />
      <Card>
        <Row title="Haptics" last right={<Toggle value={s.haptics} onChange={v => s.set({ haptics: v })} />} />
      </Card>
      <SectionHeader title="DATA" />
      <Card>
        <Row
          title="Export all systems…"
          chevron
          onPress={() => {
            const items = useLibrary.getState().items.map(i => i.doc);
            Share.share({ message: JSON.stringify(items, null, 1), title: 'systems.dsim.json' });
          }}
        />
        <Row
          title="Reset progress…"
          destructive
          last
          onPress={() =>
            Alert.alert('Reset progress?', 'Lesson checkmarks and challenge stars are cleared. Your systems stay.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: () => useProgress.getState().reset() },
            ])
          }
        />
      </Card>
      <SectionHeader title="ABOUT" />
      <Card>
        <Row title="Version" value={VERSION} last titleStyle={{ color: c.text }} />
      </Card>
    </Screen>
  );
}
