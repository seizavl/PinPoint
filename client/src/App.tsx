import { useEffect, useState, type ReactNode } from 'react';
import { ClientScreen } from './components/ClientScreen';
import { AdminMap } from './components/AdminMap';
import { AdminConsole } from './components/AdminConsole';
import { CameraAR } from './components/CameraAR';
import { HamburgerMenu } from './components/HamburgerMenu';

export default function App() {
  const path = window.location.pathname;
  // /api/me で認証確認が終わるまで描画を待つ(role判定が必要な/adminのガードのため)
  const [ready, setReady] = useState(false);
  // ハンバーガーメニューの表示制御に使うロール(管理コンソール項目の出し分け)
  const [role, setRole] = useState<'admin' | 'user' | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/me');
        if (cancelled) return;
        if (!res.ok) {
          location.replace('/login');
          return;
        }
        const data = (await res.json()) as { ok: boolean; role?: 'admin' | 'user' };
        if (path === '/admin' && data.role !== 'admin') {
          location.replace('/map');
          return;
        }
        setRole(data.role ?? null);
        setReady(true);
      } catch {
        if (!cancelled) location.replace('/login');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!ready) return null;

  let routed: ReactNode;
  if (path === '/admin') {
    routed = <AdminConsole />;
  } else if (path === '/map') {
    routed = (
      <div className="h-screen">
        <AdminMap />
      </div>
    );
  } else if (path === '/camera') {
    routed = <CameraAR />;
  } else {
    routed = <ClientScreen />;
  }

  return (
    <>
      <HamburgerMenu role={role} />
      {routed}
    </>
  );
}
