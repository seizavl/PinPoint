import { useEffect, useState } from 'react';
import { AdminMap } from './AdminMap';
import { LogoutButton } from './LogoutButton';

interface AdminUser {
  username: string;
  role: 'admin' | 'user';
  createdAt: number;
}

interface InviteResult {
  url: string;
  token: string;
  expiresAt: number;
}

function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString('ja-JP');
}

export function AdminConsole() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [invite, setInvite] = useState<InviteResult | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  async function loadUsers() {
    setUsersLoading(true);
    try {
      const res = await fetch('/api/admin/users');
      if (res.ok) {
        const data = (await res.json()) as { users: AdminUser[] };
        setUsers(data.users);
      }
    } finally {
      setUsersLoading(false);
    }
  }

  useEffect(() => {
    loadUsers();
  }, []);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleCreateInvite() {
    setInviteLoading(true);
    setCopied(false);
    try {
      const res = await fetch('/api/admin/invite', { method: 'POST' });
      if (res.ok) {
        const data = (await res.json()) as InviteResult;
        setInvite(data);
      } else {
        showToast('招待URLの発行に失敗しました');
      }
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleCopyInvite() {
    if (!invite) return;
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      showToast('コピーに失敗しました');
    }
  }

  async function handleDeleteUser(username: string) {
    if (!confirm(`ユーザー「${username}」を削除しますか？この操作は取り消せません。`)) return;
    const res = await fetch('/api/admin/users/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username }),
    });
    if (res.ok) {
      showToast(`「${username}」を削除しました`);
      loadUsers();
    } else {
      const data = await res.json().catch(() => null);
      showToast((data && data.error) || '削除に失敗しました');
    }
  }

  async function handleClearLocations() {
    if (!confirm('全ユーザーの位置情報を削除します。よろしいですか？')) return;
    setClearing(true);
    try {
      const res = await fetch('/api/admin/clear-locations', { method: 'POST' });
      if (res.ok) {
        showToast('全位置情報を削除しました');
      } else {
        showToast('位置情報の削除に失敗しました');
      }
    } finally {
      setClearing(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-slate-900 text-white">
      {/* ツールバー */}
      <header className="flex items-center justify-between px-4 py-3 pr-12 bg-slate-800 shadow z-10">
        <h1 className="text-lg font-bold text-blue-400">管理コンソール</h1>
        <LogoutButton />
      </header>

      <div className="flex-1 flex flex-col gap-4 p-4">
        {/* 招待URL発行 */}
        <section className="bg-slate-800 rounded-2xl p-4 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-blue-300">招待URLを発行</h2>
          <button
            type="button"
            onClick={handleCreateInvite}
            disabled={inviteLoading}
            className="self-start px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 text-sm font-bold transition-colors"
          >
            {inviteLoading ? '発行中...' : '招待URLを発行'}
          </button>
          {invite && (
            <div className="flex flex-col gap-2">
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  readOnly
                  value={invite.url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-slate-200"
                />
                <button
                  type="button"
                  onClick={handleCopyInvite}
                  className="px-3 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold whitespace-nowrap"
                >
                  {copied ? 'コピーしました' : 'コピー'}
                </button>
              </div>
              <p className="text-xs text-slate-400">有効期限: {formatDateTime(invite.expiresAt)} まで(単一使用)</p>
            </div>
          )}
        </section>

        {/* ユーザー一覧 */}
        <section className="bg-slate-800 rounded-2xl p-4 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-blue-300">ユーザー一覧</h2>
          {usersLoading ? (
            <p className="text-xs text-slate-400">読み込み中...</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-700">
                    <th className="py-1.5 pr-2">ユーザー名</th>
                    <th className="py-1.5 pr-2">ロール</th>
                    <th className="py-1.5 pr-2">作成日時</th>
                    <th className="py-1.5 pr-2" />
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.username} className="border-b border-slate-700/50">
                      <td className="py-1.5 pr-2 break-all">{u.username}</td>
                      <td className="py-1.5 pr-2">{u.role === 'admin' ? '管理者' : '一般'}</td>
                      <td className="py-1.5 pr-2 whitespace-nowrap">{formatDateTime(u.createdAt)}</td>
                      <td className="py-1.5 pr-2 text-right">
                        {u.role !== 'admin' && (
                          <button
                            type="button"
                            onClick={() => handleDeleteUser(u.username)}
                            className="px-2 py-1 rounded bg-red-600/80 hover:bg-red-600 text-white text-[11px] font-semibold"
                          >
                            削除
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {users.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-3 text-center text-slate-500">
                        ユーザーがいません
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* 危険操作 */}
        <section className="bg-slate-800 rounded-2xl p-4 flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-red-300">危険な操作</h2>
          <button
            type="button"
            onClick={handleClearLocations}
            disabled={clearing}
            className="self-start px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 disabled:bg-slate-600 text-sm font-bold transition-colors"
          >
            {clearing ? '削除中...' : '全位置情報を削除'}
          </button>
        </section>

        {/* マップ (既存の AdminMap をそのまま埋め込む) */}
        <section className="bg-slate-800 rounded-2xl overflow-hidden" style={{ height: '70vh' }}>
          <AdminMap />
        </section>
      </div>

      {/* トースト */}
      {toast && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full bg-slate-700 text-sm shadow-lg z-20">
          {toast}
        </div>
      )}
    </div>
  );
}
