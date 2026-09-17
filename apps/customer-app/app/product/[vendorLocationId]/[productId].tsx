import { useLocalSearchParams } from 'expo-router';
import { NativeStorePage } from '../../../native-pages';
export default function ProductRoute() {
  const { vendorLocationId, productId } = useLocalSearchParams<{
    vendorLocationId: string;
    productId: string;
  }>();
  return <NativeStorePage productId={productId} vendorLocationId={vendorLocationId} />;
}
