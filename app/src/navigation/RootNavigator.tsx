import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { problems, topics } from '@dsims/content';
import { groupLabel } from '../lib/demoGroups';
import type { RootStackParamList } from './types';
import { useTheme } from '../theme';
import { HomeScreen, LATE_SECTIONS, TOPIC_SECTIONS } from '../screens/HomeScreen';
import { TopicsScreen } from '../screens/TopicsScreen';
import { LanguageScreen, LanguagesScreen } from '../screens/LanguageScreen';
import { langName } from '../lib/languages';
import { TopicScreen } from '../screens/TopicScreen';
import { ProblemsScreen } from '../screens/ProblemsScreen';
import { ProblemScreen } from '../screens/ProblemScreen';
import { AlgorithmsScreen } from '../screens/AlgorithmsScreen';
import { AlgorithmPlayerScreen } from '../screens/AlgorithmPlayerScreen';
import { MySystemsScreen } from '../screens/MySystemsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { EditorScreen } from '../screens/EditorScreen';
import { MetricsScreen } from '../screens/MetricsScreen';
import { TourScreen } from '../debug/TourScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
export function RootNavigator() {
  const { c } = useTheme();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: c.canvas },
        headerTintColor: c.accent,
        headerTitleStyle: { color: c.text, fontWeight: '600' },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: 'minimal',
        contentStyle: { backgroundColor: c.canvas },
      }}
    >
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false, title: 'Home' }} />
      <Stack.Screen name="Topics" component={TopicsScreen} options={({ route }) => ({ title: [...TOPIC_SECTIONS, ...LATE_SECTIONS].find(s => s.id === route.params.group)?.title ?? 'Topics' })} />
      <Stack.Screen name="Languages" component={LanguagesScreen} options={{ title: 'Languages' }} />
      <Stack.Screen name="Language" component={LanguageScreen} options={({ route }) => ({ title: langName(route.params.id) })} />
      <Stack.Screen name="Problems" component={ProblemsScreen} />
      <Stack.Screen name="Algorithms" component={AlgorithmsScreen} options={({ route }) => ({ title: route.params?.group ? groupLabel(route.params.group) : 'Animations' })} />
      <Stack.Screen name="Mine" component={MySystemsScreen} options={{ title: 'My systems' }} />
      <Stack.Screen name="Topic" component={TopicScreen} options={({ route }) => ({ title: topics.find(t => t.id === route.params.topicId)?.title ?? 'Topic' })} />
      <Stack.Screen name="Problem" component={ProblemScreen} options={({ route }) => ({ title: problems.find(p => p.id === route.params.problemId)?.title ?? 'Problem' })} />
      <Stack.Screen name="AlgorithmPlayer" component={AlgorithmPlayerScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Metrics" component={MetricsScreen} />
      <Stack.Screen name="Editor" component={EditorScreen} options={{ headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: false }} />
      <Stack.Screen name="Tour" component={TourScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
