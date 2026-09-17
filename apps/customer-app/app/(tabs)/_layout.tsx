import { Tabs } from 'expo-router';
import { colors } from '@neighbourhood-store/ui-tokens/native';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerTintColor: colors.evergreen,
        tabBarActiveTintColor: colors.evergreen,
        tabBarInactiveTintColor: colors.textSecondary,
        headerStyle: { backgroundColor: colors.surface },
        tabBarStyle: { backgroundColor: colors.surface },
        tabBarLabelStyle: { fontSize: 12 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home' }} />
      <Tabs.Screen name="categories" options={{ title: 'Categories' }} />
      <Tabs.Screen name="stores" options={{ title: 'My stores' }} />
      <Tabs.Screen name="orders" options={{ title: 'Orders' }} />
      <Tabs.Screen name="account" options={{ title: 'Account' }} />
    </Tabs>
  );
}
