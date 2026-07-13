// ログインページ (外部リソースなしの自己完結HTML)。未認証ユーザーはここへリダイレクトされる。
export const LOGIN_HTML = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>ログイン - PinPoint</title>
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
    <p class="sub">ログインしてください</p>
    <form id="loginForm">
      <label for="username">ユーザー名</label>
      <input id="username" name="username" type="text" autocomplete="username" required />
      <label for="password">パスワード</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required />
      <button type="submit" id="submitBtn">ログイン</button>
      <div id="error"></div>
    </form>
  </div>
  <script>
    const form = document.getElementById('loginForm');
    const errorEl = document.getElementById('error');
    const submitBtn = document.getElementById('submitBtn');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      submitBtn.disabled = true;
      const username = document.getElementById('username').value;
      const password = document.getElementById('password').value;
      try {
        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username, password }),
        });
        if (res.ok) {
          location.replace('/');
          return;
        }
        errorEl.textContent = 'ユーザー名またはパスワードが正しくありません';
      } catch (err) {
        errorEl.textContent = '通信エラーが発生しました';
      } finally {
        submitBtn.disabled = false;
      }
    });
  </script>
</body>
</html>`;
