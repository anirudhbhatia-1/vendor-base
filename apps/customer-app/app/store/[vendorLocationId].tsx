import { useLocalSearchParams } from 'expo-router';
import { NativeStorePage } from '../../native-pages';
export default function StoreRoute() {
  const { vendorLocationId } = useLocalSearchParams<{ vendorLocationId: string }>();
  return <NativeStorePage vendorLocationId={vendorLocationId} />;
}
