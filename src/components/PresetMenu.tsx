import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { CloseIcon } from "./Icons";

export interface PlatformPreset {
  id: string;
  name: string;
  platforms: string[];
  variants: Record<string, string>;
}

interface Props {
  presets: PlatformPreset[];
  onApply: (preset: PlatformPreset) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
}

/** Dropdown for saving and re-applying named platform selections. */
export function PresetMenu({ presets, onApply, onSave, onDelete }: Props) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const root = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function close() {
    setOpen(false);
    setNaming(false);
    setName("");
  }

  function save() {
    if (!name.trim()) return;
    onSave(name.trim());
    close();
  }

  return (
    <div className="menu" ref={root}>
      <button
        type="button"
        className="link-button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {t("presets.button")} ▾
      </button>

      {open && (
        <div className="menu-popover" role="menu">
          {presets.length === 0 && <div className="menu-empty muted">{t("presets.empty")}</div>}
          {presets.map((preset) => (
            <div key={preset.id} className="menu-item-row">
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  onApply(preset);
                  close();
                }}
              >
                {preset.name}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={t("presets.delete", { name: preset.name })}
                title={t("presets.delete", { name: preset.name })}
                onClick={() => onDelete(preset.id)}
              >
                <CloseIcon width={14} height={14} />
              </button>
            </div>
          ))}

          <div className="menu-divider" />
          {naming ? (
            <form
              className="menu-form"
              onSubmit={(e) => {
                e.preventDefault();
                save();
              }}
            >
              <input
                autoFocus
                className="text-input"
                value={name}
                maxLength={40}
                placeholder={t("presets.namePlaceholder")}
                onChange={(e) => setName(e.target.value)}
              />
              <div className="menu-form-actions">
                <button type="button" className="link-button" onClick={() => setNaming(false)}>
                  {t("presets.cancel")}
                </button>
                <button type="submit" className="primary-button small" disabled={!name.trim()}>
                  {t("presets.confirm")}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" role="menuitem" className="menu-item" onClick={() => setNaming(true)}>
              {t("presets.save")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
