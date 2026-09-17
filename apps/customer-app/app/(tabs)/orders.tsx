import { ScrollView } from 'react-native';
import { Orders } from '../../Orders';
import { useCustomerSession } from '../../session-context';

export default function OrdersScreen() {
  const { accessToken } = useCustomerSession();
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Orders accessToken={accessToken} />
    </ScrollView>
  );
}
