import RNHapticFeedback from 'react-native-haptic-feedback';
import { useSettings } from '../state/settings';

type Kind = 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'select';

const map = {
  light: 'impactLight',
  medium: 'impactMedium',
  heavy: 'impactHeavy',
  success: 'notificationSuccess',
  warning: 'notificationWarning',
  error: 'notificationError',
  select: 'selection',
} as const;

export function haptic(kind: Kind) {
  if (!useSettings.getState().haptics) return;
  RNHapticFeedback.trigger(map[kind] as any, { enableVibrateFallback: false, ignoreAndroidSystemSettings: false });
}
