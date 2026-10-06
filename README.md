# Tauricon

從一張圖片產生各平台 App 圖示的桌面工具，完全在本機執行。

![Tauricon](design/app-icon.svg)

## 功能

- **輸入**：PNG、JPG、WebP、SVG（SVG 會在每個尺寸直接向量渲染，小圖示也清晰）
- **平台**：iOS / iPadOS（全尺寸或 Xcode 14+ 單一尺寸）、watchOS、macOS（`.icns`）、Android（各密度、圓形、自適應與主題圖示）、Windows（`.ico`）、Web / PWA、Tauri（`src-tauri/icons`）
- **樣式編輯**：純色或漸層背景、內距、圓角、macOS 標準樣板（內縮＋圓角＋陰影）
- **Android 自適應分層**：前景、背景、單色圖層可各自指定圖片
- **批次處理**：一次為多張圖產生圖示
- **圖片集**：Xcode Image Set（@1x/@2x/@3x）與 Android drawable
- 輸出為 ZIP 或資料夾、PNG 無損壓縮、深色模式、繁中／簡中／English

## 開發

需求：Node.js 20+、Rust（stable, MSVC）、Visual Studio C++ 建置工具、WebView2

```powershell
npm install
npm run tauri dev      # 開發模式
npm run tauri build    # 建置安裝檔，見 docs/release-windows.md
cargo test -p icon-core
```

不透過介面直接產生圖示：

```powershell
cargo run -p icon-core --release --example generate -- 圖片.svg 輸出.zip [平台...]
```

## 專案結構

| 路徑 | 內容 |
|---|---|
| `crates/icon-core` | 核心引擎（Rust）：讀圖、渲染、樣式、各平台輸出 |
| `crates/icon-core/presets` | 各平台規格表（JSON），調整尺寸不需改程式 |
| `src-tauri` | Tauri 指令層 |
| `src` | React 介面；語系檔在 `src/locales`（新增語言只需加一個 JSON） |
| `design/app-icon.svg` | App 圖示原始檔（`src-tauri/icons` 由 Tauricon 自己產生） |

© 2026 Shawn
