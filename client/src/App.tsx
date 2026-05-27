import { ClientScreen } from './components/ClientScreen';
import { AdminMap } from './components/AdminMap';
import { CameraAR } from './components/CameraAR';

export default function App() {
  const path = window.location.pathname;

  if (path === '/admin') return <AdminMap />;
  if (path === '/camera') return <CameraAR />;
  return <ClientScreen />;
}
