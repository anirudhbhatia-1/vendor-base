import { ScrollView } from 'react-native';
import { Marketplace } from '../../Marketplace';
import { useCustomerSession } from '../../session-context';

export default function CategoriesScreen() {
  const { accessToken } = useCustomerSession();
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <Marketplace accessToken={accessToken} />
    </ScrollView>
  );
}
