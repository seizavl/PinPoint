// 招待URLからの新規登録ページ (外部リソースなしの自己完結HTML)
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function signupHtml(inviteToken: string): string {
  const safeToken = escapeHtml(inviteToken);
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>新規登録 - PinPoint</title>
<style>
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #0f172a;
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Hiragino Sans, sans-serif;
  }
  .card {
    width: 100%;
    max-width: 360px;
    background: #1e293b;
    border-radius: 16px;
    padding: 32px 28px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.4);
  }
  h1 { margin: 0 0 4px; font-size: 22px; color: #3b82f6; text-align: center; }
  p.sub { margin: 0 0 24px; text-align: center; color: #94a3b8; font-size: 13px; }
  label { display: block; font-size: 13px; color: #94a3b8; margin-bottom: 6px; }
  input {
    width: 100%;
    padding: 10px 12px;
    margin-bottom: 16px;
    border-radius: 8px;
    border: 1px solid #334155;
    background: #0f172a;
    color: #e2e8f0;
    font-size: 15px;
  }
  input:focus { outline: none; border-color: #3b82f6; }
  button {
    width: 100%;
    padding: 12px;
    border: none;
    border-radius: 8px;
    background: #3b82f6;
    color: #fff;
    font-weight: bold;
    font-size: 15px;
    cursor: pointer;
  }
  button:hover { background: #2563eb; }
  button:disabled { background: #475569; cursor: not-allowed; }
  #error {
    margin-top: 14px;
    color: #f87171;
    font-size: 13px;
    text-align: center;
    min-height: 16px;
  }
</style>
</head>
<body>
  <div class="card">
    <h1>PinPoint</h1>
    <p class="sub">招待による新規登録</p>
    <form id="signupForm">
      <label for="username">ユーザー名</label>
      <input id="username" name="username" type="text" autocomplete="username" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]+" />
      <label for="password">パスワード</label>
      <input id="password" name="password" type="password" autocomplete="new-password" required minlength="8" />
      <label for="password2">パスワード（確認）</label>
      <input id="password2" name="password2" type="password" autocomplete="new-password" required minlength="8" />
      <button type="submit" id="submitBtn">登録する</button>
      <div id="error"></div>
    </form>
  </div>
  <script>
    const inviteToken = "${safeToken}";
    const form = document.getElementById('signupForm');
    const errorEl = document.getElementById('error');
    const submitBtn = document.getElementById('submitBtn');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      const password2 = document.getElementById('password2').value;
      if (password !== password2) {
        errorEl.textContent = 'パスワードが一致しません';
        return;
      }
      if (!inviteToken) {
        errorEl.textContent = '招待リンクが指定されていません';
        return;
      }
      submitBtn.disabled = true;
      try {
        const res = await fetch('/api/signup', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invite: inviteToken, username, password }),
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.ok) {
          location.replace('/');
          return;
        }
        errorEl.textContent = (data && data.error) || '登録に失敗しました';
      } catch (err) {
        errorEl.textContent = '通信エラーが発生しました';
      } finally {
        submitBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}
