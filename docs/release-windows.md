# Windows 發佈流程

## 建置安裝檔

```powershell
npm install
npm run tauri build
```

產出：`target/release/bundle/nsis/Tauricon_<版本>_x64-setup.exe`

- 安裝模式：目前使用者（`currentUser`），**不需要系統管理員權限**，安裝到 `%LOCALAPPDATA%\Tauricon`
- 安裝介面語言：繁體中文、簡體中文、English，啟動時可選擇（預設依系統語言）
- WebView2：Windows 10/11 通常已內建；若缺少，安裝程式會自動下載

## 發佈新版本前

1. 同步修改三處版本號：
   - `src-tauri/tauri.conf.json` → `version`
   - `src-tauri/Cargo.toml` → `version`
   - `package.json` → `version`
2. 執行測試：`cargo test -p icon-core`、`npx tsc --noEmit`
3. 建置後，在乾淨的環境（或另一個 Windows 帳號）實際安裝、執行、解除安裝一次

## 程式碼簽章（尚未啟用）

沒有簽章時，Windows SmartScreen 會顯示「Windows 已保護您的電腦／不明的發行者」，使用者需按「其他資訊 → 仍要執行」。取得憑證後擇一設定：

### 方案 A：傳統程式碼簽章憑證（OV / EV）

1. 向憑證商購買程式碼簽章憑證，並安裝到 Windows 憑證存放區（EV 憑證通常在 USB 硬體金鑰中）
2. 取得憑證指紋（Thumbprint）：
   ```powershell
   Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Format-List Subject, Thumbprint
   ```
3. 在 `src-tauri/tauri.conf.json` 的 `bundle.windows` 加入：
   ```json
   "certificateThumbprint": "<你的指紋>",
   "digestAlgorithm": "sha256",
   "timestampUrl": "http://timestamp.digicert.com"
   ```
4. 重新 `npm run tauri build`，Tauri 會自動簽署 `Tauricon.exe` 與安裝檔

### 方案 B：Azure Trusted Signing（雲端簽章，費用較低）

在 `bundle.windows` 設定 `signCommand`，由 Tauri 在建置時呼叫簽章工具，例如：

```json
"signCommand": "trusted-signing-cli -e <endpoint> -a <account> -c <profile> %1"
```

> 註：OV 憑證剛開始使用時，SmartScreen 仍可能警告，需累積下載量建立信譽；EV 憑證可立即建立信譽。

## 驗證簽章

```powershell
Get-AuthenticodeSignature .\target\release\bundle\nsis\Tauricon_*_x64-setup.exe | Format-List Status, SignerCertificate
```
