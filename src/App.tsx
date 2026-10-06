// Phase 2 verification screen: exercises every command end to end.
// Replaced by the real UI in Phase 3.
import { useEffect, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { open, save } from "@tauri-apps/plugin-dialog";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import {
  generateIcons,
  isCommandError,
  listPlatforms,
  loadSource,
  renderPreview,
  SUPPORTED_EXTENSIONS,
  type GenerateReport,
  type OutputTarget,
  type PlatformInfo,
  type Progress,
  type SourceInfo,
} from "./lib/api";
import "./App.css";

const ERROR_MESSAGES: Record<string, string> = {
  io: "無法讀取或寫入檔案",
  unsupportedFormat: "不支援的檔案格式",
  decode: "圖片解碼失敗",
  svg: "SVG 解析失敗",
  inputTooLarge: "檔案太大（上限 50MB）",
  dimensionsTooLarge: "圖片尺寸太大（上限 16384px）",
  emptyImage: "圖片沒有內容",
  noSource: "請先選擇圖片",
  noPlatforms: "請至少選擇一個平台",
};

function describeError(err: unknown): string {
  if (isCommandError(err)) return `${ERROR_MESSAGES[err.code] ?? "發生錯誤"}（${err.message}）`;
  return String(err);
}

function App() {
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [source, setSource] = useState<SourceInfo | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [padding, setPadding] = useState(0);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [report, setReport] = useState<GenerateReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listPlatforms().then((list) => {
      setPlatforms(list);
      setSelected(list.map((p) => p.id));
    });
  }, []);

  async function load(path: string) {
    setError(null);
    setReport(null);
    try {
      setSource(await loadSource(path));
    } catch (err) {
      setError(describeError(err));
    }
  }

  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop" && event.payload.paths.length > 0) {
        load(event.payload.paths[0]);
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (!source) return;
    let url: string | null = null;
    renderPreview(256, null, padding)
      .then((u) => {
        url = u;
        setPreview(u);
      })
      .catch((err) => setError(describeError(err)));
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [source, padding]);

  async function pickFile() {
    const path = await open({
      multiple: false,
      filters: [{ name: "圖片", extensions: SUPPORTED_EXTENSIONS }],
    });
    if (path) load(path);
  }

  async function run(kind: OutputTarget["kind"]) {
    const path =
      kind === "zip"
        ? await save({ defaultPath: "AppIcons.zip", filters: [{ name: "ZIP", extensions: ["zip"] }] })
        : await open({ directory: true });
    if (!path) return;

    setError(null);
    setReport(null);
    setProgress({ done: 0, total: 1 });
    try {
      const result = await generateIcons(
        { platforms: selected, background: null, padding },
        { kind, path },
        setProgress,
      );
      setReport(result);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setProgress(null);
    }
  }

  function toggle(id: string) {
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }

  return (
    <main className="container">
      <h1>App Icon Generator</h1>
      <p className="hint">Phase 2 測試畫面：拖放圖片到視窗，或按按鈕選擇。</p>

      <button onClick={pickFile}>選擇圖片…</button>

      {source && (
        <section>
          <p>
            {source.fileName} · {source.kind === "vector" ? "SVG" : "點陣圖"} ·{" "}
            {Math.round(source.width)}×{Math.round(source.height)}
            {source.warnings.includes("notSquare") && " · ⚠ 非正方形"}
            {source.warnings.includes("lowResolution") && " · ⚠ 解析度低於 1024"}
          </p>
          {preview && <img className="preview" src={preview} alt="預覽" width={128} height={128} />}
          <label>
            內距 {Math.round(padding * 100)}%
            <input
              type="range"
              min={0}
              max={0.4}
              step={0.01}
              value={padding}
              onChange={(e) => setPadding(Number(e.target.value))}
            />
          </label>
        </section>
      )}

      <section className="platforms">
        {platforms.map((p) => (
          <label key={p.id}>
            <input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)} />
            {p.name}（{p.fileCount}）
          </label>
        ))}
      </section>

      <div className="row">
        <button disabled={!source || !!progress} onClick={() => run("zip")}>
          產生 ZIP…
        </button>
        <button disabled={!source || !!progress} onClick={() => run("folder")}>
          輸出到資料夾…
        </button>
      </div>

      {progress && <progress value={progress.done} max={progress.total} />}
      {error && <p className="error">{error}</p>}
      {report && (
        <p>
          完成：{report.fileCount} 個檔案，{(report.totalBytes / 1024).toFixed(0)} KB，
          {report.elapsedMs} ms{" "}
          <button onClick={() => revealItemInDir(report.outputPath)}>在檔案總管中顯示</button>
        </p>
      )}
    </main>
  );
}

export default App;
