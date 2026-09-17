import { ScrollView } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { Orders } from '../../Orders';
import { useCustomerSession } from '../../session-context';
export default function OrderRoute() {
  const { vendorOrderId } = useLocalSearchParams<{ vendorOrderId: string }>();
  const { accessToken } = useCustomerSession();
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Orders accessToken={accessToken} vendorOrderId={vendorOrderId} />
    </ScrollView>
  );
}
