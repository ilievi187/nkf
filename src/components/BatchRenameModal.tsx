import React, { useMemo, useState } from "react";
import { ArrowRight, Check } from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { nkfApi, type FileEntry } from "../lib/api";

interface BatchRenameModalProps {
  open: boolean;
  items: FileEntry[];
  onClose: () => void;
  onDone: (count: number) => void;
  onError: (msg: string) => void;
}

export const BatchRenameModal: React.FC<BatchRenameModalProps> = ({
  open,
  items,
  onClose,
  onDone,
  onError,
}) => {
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [addNumbering, setAddNumbering] = useState(false);
  const [startNum, setStartNum] = useState(1);

  const previews = useMemo(() => {
    return items.map((item, idx) => {
      const dot = !item.is_dir ? item.name.lastIndexOf(".") : -1;
      const stem = dot > 0 ? item.name.slice(0, dot) : item.name;
      const ext = dot > 0 ? item.name.slice(dot) : "";

      let nextStem = stem;
      if (findText) {
        nextStem = nextStem.split(findText).join(replaceText);
      }
      const num = addNumbering ? `_${String(startNum + idx).padStart(3, "0")}` : "";
      const nextName = `${prefix}${nextStem}${suffix}${num}${ext}`;
      return { path: item.path, oldName: item.name, newName: nextName };
    });
  }, [items, findText, replaceText, prefix, suffix, addNumbering, startNum]);

  const changedCount = previews.filter((p) => p.oldName !== p.newName).length;

  const apply = async () => {
    try {
      const pairs: [string, string][] = previews
        .filter((p) => p.oldName !== p.newName)
        .map((p) => [p.path, p.newName]);
      const count = await nkfApi.batchRename(pairs);
      onDone(count);
      onClose();
    } catch (e) {
      onError(String(e));
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Smart Batch Rename"
      subtitle={`Renaming ${items.length} selected items with live preview`}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
              Find text
            </label>
            <input
              type="text"
              value={findText}
              onChange={(e) => setFindText(e.target.value)}
              placeholder="e.g. IMG_"
              className="w-full px-3 py-1.5 rounded-lg text-xs border"
              style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
              Replace with
            </label>
            <input
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              placeholder="e.g. Vacation_"
              className="w-full px-3 py-1.5 rounded-lg text-xs border"
              style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
              Prefix
            </label>
            <input
              type="text"
              value={prefix}
              onChange={(e) => setPrefix(e.target.value)}
              placeholder="Added before name"
              className="w-full px-3 py-1.5 rounded-lg text-xs border"
              style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
              Suffix (before extension)
            </label>
            <input
              type="text"
              value={suffix}
              onChange={(e) => setSuffix(e.target.value)}
              placeholder="Added after name"
              className="w-full px-3 py-1.5 rounded-lg text-xs border"
              style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <label className="inline-flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={addNumbering}
              onChange={(e) => setAddNumbering(e.target.checked)}
            />
            Append sequential number (_001, _002...)
          </label>
          {addNumbering && (
            <input
              type="number"
              min={0}
              value={startNum}
              onChange={(e) => setStartNum(Number(e.target.value))}
              className="w-20 px-2 py-1 rounded border text-xs"
              style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
            />
          )}
        </div>

        <div
          className="rounded-xl border max-h-56 overflow-y-auto nkf-scroll divide-y"
          style={{ borderColor: "var(--border)", background: "var(--bg)" }}
        >
          {previews.map((p) => (
            <div
              key={p.path}
              className="px-3 py-1.5 text-xs flex items-center gap-2"
              style={{ borderColor: "var(--border)" }}
            >
              <span className="truncate flex-1" style={{ color: "var(--text-muted)" }}>
                {p.oldName}
              </span>
              <ArrowRight size={12} className="shrink-0 opacity-60" />
              <span
                className="truncate flex-1 font-medium"
                style={{ color: p.oldName !== p.newName ? "var(--accent)" : "var(--text)" }}
              >
                {p.newName}
              </span>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={changedCount === 0}
            onClick={apply}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40"
            style={{ background: "var(--accent)", color: "var(--accent-text)" }}
          >
            <Check size={14} /> Rename {changedCount} Item{changedCount === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};
