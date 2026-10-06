# Windows 發佈流程

## 自動發佈（GitHub Actions）

推送版本標籤後，GitHub Actions 會自動建置安裝檔並建立 Release 草稿。

### 步驟

1. **更新版本號**（一次修改 `tauri.conf.json`、`Cargo.toml`、`package.json` 與 lockfile）：
   ```powershell
   npm run set-version 0.2.0
   ```
2. **撰寫變更紀錄**：在 `CHANGELOG.md` 最上方新增 `## [0.2.0] - 日期` 段落。這段內容會自動成為 Release 說明
3. **commit 並推送**：
   ```powershell
   git commit -am "Release 0.2.0"
   git push origin develop
   ```
   等 CI 通過（GitHub 上 Actions 分頁顯示綠色勾勾），再把 `master` 更新到這個版本並推送
4. **打上標籤並推送**：
   ```powershell
   git tag v0.2.0
   git push origin v0.2.0
   ```
5. **等待建置**（約 10–15 分鐘）：到 GitHub 的 **Actions** 分頁可以看到進度
6. **檢查並發佈**：到 **Releases**，會看到一個草稿，確認說明與附件 `Tauricon_0.2.0_x64-setup.exe` 無誤後，按 **Publish release**

> 建議在發佈前下載草稿中的安裝檔，實際安裝、執行、解除安裝一次。

### 防呆機制

- 標籤版本與設定檔版本不一致時（例如忘了執行 `set-version`），建置會直接失敗，不會產生錯誤版本
- `CHANGELOG.md` 缺少該版本段落時，建置也會失敗
- Release 一律先建立為**草稿**，不會在檢查前公開

### 工作流程檔

| 檔案 | 觸發時機 | 內容 |
|---|---|---|
| `.github/workflows/ci.yml` | 推送到 `master`／`develop`、Pull Request | 格式檢查、clippy、TypeScript 檢查、測試 |
| `.github/workflows/release.yml` | 推送 `v*` 標籤 | 版本檢查、測試、建置安裝檔、建立 Release 草稿 |

## 手動建置安裝檔

在本機建置（例如測試用）：

```powershell
npm install
npm run tauri build
```

產出：`target/release/bundle/nsis/Tauricon_<版本>_x64-setup.exe`

- 安裝模式：目前使用者（`currentUser`），**不需要系統管理員權限**，安裝到 `%LOCALAPPDATA%\Tauricon`
- 安裝介面語言：繁體中文、簡體中文、English，啟動時可選擇（預設依系統語言）
- WebView2：Windows 10/11 通常已內建；若缺少，安裝程式會自動下載

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
