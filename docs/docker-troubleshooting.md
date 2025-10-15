# Docker Desktop トラブルシューティング

## よくある問題と解決方法

### 1. Docker Desktopが起動しない

**症状**: Docker Desktopのアイコンをクリックしても起動しない、またはエラーが表示される

**解決方法**:

#### A. WSL2の確認
```powershell
# PowerShellを管理者権限で実行
wsl --status
wsl --update
```

#### B. Hyper-Vの有効化
1. Windowsの「機能の有効化または無効化」を開く
2. 以下にチェックを入れる：
   - Hyper-V
   - Windows ハイパーバイザー プラットフォーム
   - 仮想マシン プラットフォーム
3. 再起動

#### C. Docker Desktopの再インストール
1. Docker Desktopをアンインストール
2. `C:\Users\[ユーザー名]\AppData\Local\Docker` を削除
3. 最新版をダウンロード: https://www.docker.com/products/docker-desktop/
4. 再インストール

### 2. "500 Internal Server Error"

**症状**: docker-composeコマンド実行時にエラー

**解決方法**:
- Docker Desktopを完全に再起動
- WSL2の再起動: `wsl --shutdown` → Docker Desktop再起動

### 3. Windows Homeエディション

Windows Homeの場合、Docker Desktopが動作しないことがあります。
→ WSL2 + Docker CEを使用する方法に切り替えてください

## サポート

問題が解決しない場合は、上記の「選択肢1: クラウドデータベース」の使用をお勧めします。
