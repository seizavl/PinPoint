// ログアウトボタン。各画面の隅に配置する小さめのボタン。
export function LogoutButton() {
  async function handleLogout() {
    try {
      await fetch('/api/logout', { method: 'POST' });
    } finally {
      location.replace('/login');
    }
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-xs font-semibold text-slate-200 transition-colors"
    >
      ログアウト
    </button>
  );
}
