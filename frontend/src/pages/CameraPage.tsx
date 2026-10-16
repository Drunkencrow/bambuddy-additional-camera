import { useParams } from 'react-router-dom';
import { PrimaryCameraPane } from '../components/PrimaryCameraPane';

export function CameraPage() {
  const { printerId } = useParams<{ printerId: string }>();
  return <PrimaryCameraPane printerId={parseInt(printerId || '0', 10)} />;
}
