<p align="center">
  <img src="design/app-icon.svg" width="112" alt="Tauricon">
</p>

<h1 align="center">Tauricon</h1>

<p align="center">
  從一張圖片，產生所有平台需要的 App 圖示。<br>
  完全在你的電腦上執行，圖片不會上傳到任何地方。
</p>

<p align="center">
  繁體中文 ｜ <a href="README.en.md">English</a>
</p>

<!-- 截圖：完成後取消註解
<p align="center">
  <img src="docs/images/main.png" width="860" alt="Tauricon 主畫面">
</p>
-->

## 功能特色

- **一張圖，全部平台**：iOS / iPadOS、watchOS、macOS、Android、Windows、Web / PWA、Tauri
- **支援 SVG**：每個尺寸都直接從向量渲染，16px 的小圖示也清晰
- **可直接使用的輸出**：Xcode 的 `AppIcon.appiconset`（含 `Contents.json`）、macOS `.icns`、Windows `.ico`、Android `mipmap` 資料夾、PWA `manifest`
- **符合商店規範**：App Store 圖示自動去除透明通道，Play 商店圖維持 32 位元 PNG
- **樣式編輯器**：純色或漸層背景、內距、圓角、macOS 標準樣板（內縮＋圓角＋陰影）
- **Android 自適應圖示**：前景、背景、單色（Android 13 主題圖示）圖層可各自指定圖片
- **批次處理**：一次為多張圖片產生整套圖示
- **圖片集**：App 內用圖片的 Xcode Image Set（@1x/@2x/@3x）與 Android drawable
- **即時預覽**：各平台遮罩形狀、小尺寸清晰度、瀏覽器分頁效果
- 輸出 ZIP 或資料夾、PNG 無損壓縮、深色模式、繁中／简中／English 介面

## 下載與安裝

### 系統需求

- Windows 10 或 11（64 位元）
- Microsoft Edge WebView2（Windows 11 已內建；若缺少，安裝程式會自動下載）

### 安裝步驟

1. 從 [Releases](../../releases) 下載最新的 `Tauricon_x.y.z_x64-setup.exe`
2. 執行安裝檔，選擇介面語言後依指示完成安裝（不需要系統管理員權限）
3. 從開始功能表開啟 **Tauricon**

> **出現「Windows 已保護您的電腦」？**
> 目前的安裝檔尚未進行程式碼簽章，Windows SmartScreen 會顯示這個警告。請點選 **其他資訊 → 仍要執行** 即可繼續安裝。

### 解除安裝

到 **設定 → 應用程式 → 已安裝的應用程式**，找到 Tauricon 並選擇「解除安裝」。

## 快速上手

1. **載入圖片**：把圖片拖進視窗，或按 `Ctrl+O` 選擇檔案（建議 1024×1024 以上，或使用 SVG）
2. **調整樣式**（選用）：在左側設定背景、內距、圓角
3. **勾選平台**：在右側選擇要輸出的平台
4. **產生**：選擇輸出成 ZIP 或資料夾，按「產生」（或 `Ctrl+Enter`）

完整的功能說明請見 **[使用手冊](docs/user-guide.md)**。

## 從原始碼建置

需求：[Node.js](https://nodejs.org/) 20+、[Rust](https://rustup.rs/)（stable）、Visual Studio C++ 建置工具（「使用 C++ 的桌面開發」工作負載）

```powershell
git clone <repo-url>
cd tauricon
npm install
npm run tauri dev      # 開發模式
npm run tauri build    # 建置安裝檔（輸出在 target/release/bundle/nsis/）
cargo test -p icon-core
```

發佈流程與程式碼簽章請見 [docs/release-windows.md](docs/release-windows.md)。

### 指令列使用

不開啟介面，直接用核心引擎產生圖示：

```powershell
cargo run -p icon-core --release --example generate -- logo.svg AppIcons.zip ios android
```

可用 `ICON_OPTIONS` 環境變數帶入樣式參數（JSON 格式），例如 `{"cornerRadius":0.2,"macosTemplate":true}`。

## 專案結構

| 路徑 | 內容 |
|---|---|
| `crates/icon-core` | 核心引擎（Rust）：讀圖、渲染、樣式、各平台輸出 |
| `crates/icon-core/presets` | 各平台規格表（JSON），調整尺寸不需要改程式 |
| `src-tauri` | Tauri 指令層 |
| `src` | React 介面 |
| `src/locales` | 語系檔，新增語言只需加入一個 JSON 檔 |
| `design/app-icon.svg` | App 圖示原始檔（`src-tauri/icons` 由 Tauricon 自己產生） |

## 技術

[Tauri 2](https://tauri.app/) · [React](https://react.dev/) · [Rust](https://www.rust-lang.org/) · [resvg](https://github.com/linebender/resvg) · [fast_image_resize](https://github.com/Cykooz/fast_image_resize) · [oxipng](https://github.com/shssoichiro/oxipng)

## 授權

Tauricon 以 [PolyForm Noncommercial 1.0.0](LICENSE) 授權釋出 © 2026 Shawn。

- ✅ **可以**：個人、學習、研究、非營利組織免費使用、修改與分享
- ❌ **不可以**：販售本軟體或其修改版本、將其納入商業產品或服務、用於商業目的

> 本授權公開原始碼，但限制商業用途，因此不屬於 OSI 定義的「開源授權」。

### 商業授權

如需在商業用途中使用 Tauricon，請透過 [GitHub Issues](../../issues) 聯絡作者洽詢商業授權。
