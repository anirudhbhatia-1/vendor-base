import { ScrollView, Text, View } from 'react-native';
import { Marketplace } from '../../Marketplace';
import { useCustomerSession } from '../../session-context';

export default function StoresScreen() {
  const { accessToken } = useCustomerSession();
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <View>
        <Text style={{ fontSize: 28, fontWeight: '800' }}>Your local stores</Text>
        <Text>Favourites, preferred stores and stores serving your selected address.</Text>
      </View>
      <Marketplace accessToken={accessToken} />
    </ScrollView>
  );
}
