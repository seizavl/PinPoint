import { useEffect, useRef, useState } from 'react';

interface HamburgerMenuProps {
  role: 'admin' | 'user' | null;
}

interface MenuItem {
  label: string;
  icon: string;
  path: string;
}

const MENU_ITEMS: MenuItem[] = [
  { label: '位置送信', icon: '📍', path: '/' },
  { label: 'ARカメラ', icon: '📷', path: '/camera' },
  { label: 'マップ', icon: '🗺', path: '/map' },
];

const ADMIN_ITEM: MenuItem = { label: '管理コンソール', icon: '⚙', path: '/admin' };

// 画面右上固定のハンバーガーメニュー。全ルート共通で表示する。
export function HamburgerMenu({ role }: HamburgerMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const currentPath = window.location.pathname;

  // 外側クリックで閉じる
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // ESCで閉じる
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  function navigate(path: string) {
    setOpen(false);
    window.location.href = path;
  }

  async function handleLogout() {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } finally {
      location.replace('/login');
    }
  }

  const items = role === 'admin' ? [...MENU_ITEMS, ADMIN_ITEM] : MENU_ITEMS;

  return (
    <div ref={containerRef} className="fixed top-3 right-3 z-[1100]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="メニューを開閉"
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800/80 text-white shadow-lg backdrop-blur transition hover:bg-slate-700/80"
      >
        <span className="text-lg leading-none">☰</span>
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-52 origin-top-right rounded-2xl border border-white/10 bg-slate-900/95 p-2 shadow-2xl backdrop-blur">
          <nav className="flex flex-col gap-1">
            {items.map((item) => {
              const active = currentPath === item.path;
              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold transition-colors ${
                    active
                      ? 'bg-slate-700 text-white'
                      : 'text-slate-200 hover:bg-slate-800'
                  }`}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
          <div className="my-2 border-t border-white/10" />
          <button
            type="button"
            onClick={handleLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-300 transition-colors hover:bg-slate-800"
          >
            <span>🚪</span>
            <span>ログアウト</span>
          </button>
        </div>
      )}
    </div>
  );
}
