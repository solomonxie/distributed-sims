import React, { useEffect, useRef } from 'react';
import { Linking, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { NavigationContainer, DarkTheme, DefaultTheme, type NavigationContainerRef } from '@react-navigation/native';
import { ThemeProvider, useTheme } from './src/theme';
import { RootNavigator } from './src/navigation/RootNavigator';
import type { RootStackParamList } from './src/navigation/types';
import { runTour } from './src/debug/tour';
import { useSettings } from './src/state/settings';

function Root() {
  const { c, dark } = useTheme();
  const nav = useRef<NavigationContainerRef<RootStackParamList>>(null);
  useEffect(() => {
    useSettings.getState().set({ launches: useSettings.getState().launches + 1 });
    const handle = (url?: string | null) => {
      if (url?.startsWith('dsims://tour')) setTimeout(() => nav.current && runTour(nav.current), 1500);
    };
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', e => handle(e.url));
    return () => sub.remove();
  }, []);
  const base = dark ? DarkTheme : DefaultTheme;
  return (
    <NavigationContainer
      ref={nav}
      theme={{ ...base, colors: { ...base.colors, background: c.canvas, card: c.canvas, primary: c.accent, text: c.text, border: c.hairline } }}
    >
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <RootNavigator />
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <Root />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
