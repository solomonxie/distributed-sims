import React from 'react';
import { StyleSheet, View } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { BlurView } from '@react-native-community/blur';
import { topics } from '@dsims/content';
import type { RootStackParamList, TabParamList } from './types';
import { useTheme } from '../theme';
import { Icon } from '../ui/Icon';
import { LearnScreen } from '../screens/LearnScreen';
import { TopicScreen } from '../screens/TopicScreen';
import { ProblemsScreen } from '../screens/ProblemsScreen';
import { ProblemScreen } from '../screens/ProblemScreen';
import { AlgorithmsScreen } from '../screens/AlgorithmsScreen';
import { AlgorithmPlayerScreen } from '../screens/AlgorithmPlayerScreen';
import { MySystemsScreen } from '../screens/MySystemsScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { FeedbackScreen } from '../screens/FeedbackScreen';
import { EditorScreen } from '../screens/EditorScreen';
import { MetricsScreen } from '../screens/MetricsScreen';
import { TourScreen } from '../debug/TourScreen';
import { problems } from '@dsims/content';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<TabParamList>();

const TAB_ICON: Record<keyof TabParamList, string> = {
  Learn: 'graduation-cap',
  Problems: 'puzzle',
  Algorithms: 'diamond',
  Mine: 'layout-grid',
};

function Tabs() {
  const { c, dark } = useTheme();
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: c.accent,
        tabBarInactiveTintColor: c.text3,
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '600' },
        tabBarStyle: { position: 'absolute', borderTopColor: c.hairline, backgroundColor: 'transparent', elevation: 0 },
        tabBarBackground: () => (
          <View style={StyleSheet.absoluteFill}>
            <BlurView style={StyleSheet.absoluteFill} blurType={dark ? 'dark' : 'light'} blurAmount={24} reducedTransparencyFallbackColor={c.surface1} />
            <View style={[StyleSheet.absoluteFill, { backgroundColor: dark ? 'rgba(10,13,20,0.6)' : 'rgba(245,246,248,0.7)' }]} />
          </View>
        ),
        tabBarIcon: ({ color, focused }) => <Icon name={TAB_ICON[route.name]} size={23} color={color} strokeWidth={focused ? 2.3 : 1.8} />,
      })}
    >
      <Tab.Screen name="Learn" component={LearnScreen} />
      <Tab.Screen name="Problems" component={ProblemsScreen} />
      <Tab.Screen name="Algorithms" component={AlgorithmsScreen} options={{ title: 'Algos' }} />
      <Tab.Screen name="Mine" component={MySystemsScreen} />
    </Tab.Navigator>
  );
}

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
      <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false, title: 'Back' }} />
      <Stack.Screen name="Topic" component={TopicScreen} options={({ route }) => ({ title: topics.find(t => t.id === route.params.topicId)?.title ?? 'Topic' })} />
      <Stack.Screen name="Problem" component={ProblemScreen} options={({ route }) => ({ title: problems.find(p => p.id === route.params.problemId)?.title ?? 'Problem' })} />
      <Stack.Screen name="AlgorithmPlayer" component={AlgorithmPlayerScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="Feedback" component={FeedbackScreen} />
      <Stack.Screen name="Metrics" component={MetricsScreen} />
      <Stack.Screen name="Editor" component={EditorScreen} options={{ headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: false }} />
      <Stack.Screen name="Tour" component={TourScreen} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
