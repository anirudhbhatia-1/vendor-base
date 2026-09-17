import { Stack } from 'expo-router';
import { SessionProvider } from '../session-context';

export default function RootLayout() {
  return (
    <SessionProvider>
      <Stack screenOptions={{ headerBackTitle: 'Back', headerTintColor: '#174A3A' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="store/[vendorLocationId]" options={{ title: 'Store' }} />
        <Stack.Screen
          name="product/[vendorLocationId]/[productId]"
          options={{ title: 'Product' }}
        />
        <Stack.Screen name="order/[vendorOrderId]" options={{ title: 'Order' }} />
        <Stack.Screen name="checkout" options={{ presentation: 'modal', title: 'Checkout' }} />
        <Stack.Screen name="addresses" options={{ title: 'Delivery addresses' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
        <Stack.Screen name="sessions" options={{ title: 'Signed-in devices' }} />
        <Stack.Screen name="privacy" options={{ title: 'Privacy' }} />
        <Stack.Screen name="support" options={{ title: 'Help and support' }} />
      </Stack>
    </SessionProvider>
  );
}
