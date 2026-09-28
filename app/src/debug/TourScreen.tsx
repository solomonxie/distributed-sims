import React from 'react';
import { View } from 'react-native';
import { Text } from '../ui/primitives';

export function TourScreen() {
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
      <Text>Snapshot tour running…</Text>
    </View>
  );
}
