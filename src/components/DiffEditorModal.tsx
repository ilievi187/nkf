import React, { useEffect, useMemo, useState } from "react";
import {
  Save,
  ArrowRight,
  ArrowLeft,
  Columns2,
  AlignLeft,
  Loader2,
  Check,
  SlidersHorizontal,
} from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { fmtBytes, nkfApi, type PreviewData } from "../lib/api";
import { computeLineDiff } from "../lib/diff";

interface DiffEditorModalProps {
  open: boolean;
  leftPath: string | null;
  rightPath: string | null;
  onClose: () => void;
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

function fileNameOf(p: string | null): string {
  if (!p) return "";
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

export const DiffEditorModal: React.FC<DiffEditorModalProps> = ({
  open,
  leftPath,
  rightPath,
  onClose,
  onSaved,
  onError,
}) => {
  const [loading, setLoading] = useState(false);
  const [leftPreview, setLeftPreview] = useState<PreviewData | null>(null);
  const [rightPreview, setRightPreview] = useState<PreviewData | null>(null);

  const [leftText, setLeftText] = useState("");
  const [rightText, setRightText] = useState("");
  const [leftDirty, setLeftDirty] = useState(false);
  const [rightDirty, setRightDirty] = useState(false);
  const [mode, setMode] = useState<"edit" | "diff">("diff");
  const [saving, setSaving] = useState(false);
  const [sliderPct, setSliderPct] = useState(50);

  useEffect(() => {
    if (!open || !leftPath || !rightPath) return;
    setLoading(true);
    setLeftDirty(false);
    setRightDirty(false);
    Promise.all([nkfApi.readPreview(leftPath), nkfApi.readPreview(rightPath)])
      .then(([lp, rp]) => {
        setLeftPreview(lp);
        setRightPreview(rp);
        if (lp.kind === "text") setLeftText(lp.content);
        if (rp.kind === "text") setRightText(rp.content);
      })
      .catch((e) => onError(String(e)))
      .finally(() => setLoading(false));
  }, [open, leftPath, rightPath, onError]);

  const isBothText = leftPreview?.kind === "text" && rightPreview?.kind === "text";
  const isBothImages = leftPreview?.kind === "image" && rightPreview?.kind === "image";

  const diff = useMemo(() => {
    if (!isBothText) return null;
    return computeLineDiff(leftText, rightText);
  }, [isBothText, leftText, rightText]);

  const saveSide = async (side: "left" | "right" | "both") => {
    if (!leftPath || !rightPath) return;
    setSaving(true);
    try {
      if (side === "left" || side === "both") {
        await nkfApi.writeTextFile(leftPath, leftText);
        setLeftDirty(false);
      }
      if (side === "right" || side === "both") {
        await nkfApi.writeTextFile(rightPath, rightText);
        setRightDirty(false);
      }
      onSaved(
        side === "both"
          ? "Saved both files!"
          : `Saved ${side === "left" ? fileNameOf(leftPath) : fileNameOf(rightPath)}`
      );
    } catch (e) {
      onError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="NKF Diff & Dual Editor Studio"
      subtitle={`${fileNameOf(leftPath)}  ⇄  ${fileNameOf(rightPath)}`}
    >
      {loading ? (
        <div className="py-16 flex items-center justify-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={18} className="animate-spin" /> Loading files...
        </div>
      ) : isBothImages && leftPreview && rightPreview ? (
        /* VISUAL IMAGE COMPARE SLIDER */
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs">
            <span>
              <strong>Left:</strong> {fileNameOf(leftPath)} ({fmtBytes(leftPreview.size)})
            </span>
            <span className="inline-flex items-center gap-1.5" style={{ color: "var(--accent)" }}>
              <SlidersHorizontal size={13} /> Drag slider to compare
            </span>
            <span>
              <strong>Right:</strong> {fileNameOf(rightPath)} ({fmtBytes(rightPreview.size)})
            </span>
          </div>

          <div
            className="relative rounded-xl overflow-hidden border bg-black/40 h-[52vh] flex items-center justify-center select-none"
            style={{ borderColor: "var(--border)" }}
          >
            <img
              src={rightPreview.content}
              alt="Right"
              className="absolute inset-0 w-full h-full object-contain"
            />
            <div
              className="absolute inset-0 overflow-hidden"
              style={{ clipPath: `inset(0 ${100 - sliderPct}% 0 0)` }}
            >
              <img
                src={leftPreview.content}
                alt="Left"
                className="w-full h-full object-contain"
              />
            </div>
            <div
              className="pointer-events-none absolute top-0 bottom-0 w-0.5 bg-white shadow-lg"
              style={{ left: `${sliderPct}%` }}
            />
          </div>

          <input
            type="range"
            min={0}
            max={100}
            value={sliderPct}
            onChange={(e) => setSliderPct(Number(e.target.value))}
            className="w-full cursor-pointer"
          />
        </div>
      ) : isBothText && diff ? (
        /* DUAL TEXT/CODE LIVE EDITOR + DIFF */
        <div className="space-y-3">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setMode("diff")}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium cursor-pointer"
                style={{
                  background: mode === "diff" ? "var(--accent)" : "var(--surface-alt)",
                  color: mode === "diff" ? "var(--accent-text)" : "var(--text)",
                }}
              >
                <AlignLeft size={13} /> Visual Diff
              </button>
              <button
                type="button"
                onClick={() => setMode("edit")}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-medium cursor-pointer"
                style={{
                  background: mode === "edit" ? "var(--accent)" : "var(--surface-alt)",
                  color: mode === "edit" ? "var(--accent-text)" : "var(--text)",
                }}
              >
                <Columns2 size={13} /> Live Dual Edit
              </button>
            </div>

            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                +{diff.added}
              </span>
              <span className="px-2 py-0.5 rounded bg-red-500/20 text-red-300">
                -{diff.removed}
              </span>
              <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300">
                ~{diff.modified}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setRightText(leftText);
                  setRightDirty(true);
                }}
                title="Copy Left content to Right"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg cursor-pointer"
                style={{ background: "var(--surface-alt)" }}
              >
                L <ArrowRight size={11} /> R
              </button>
              <button
                type="button"
                onClick={() => {
                  setLeftText(rightText);
                  setLeftDirty(true);
                }}
                title="Copy Right content to Left"
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg cursor-pointer"
                style={{ background: "var(--surface-alt)" }}
              >
                L <ArrowLeft size={11} /> R
              </button>
            </div>
          </div>

          {mode === "diff" ? (
            /* SIDE-BY-SIDE VISUAL DIFF TABLE */
            <div
              className="rounded-xl border overflow-auto max-h-[52vh] nkf-scroll font-mono text-[11px]"
              style={{ borderColor: "var(--border)", background: "var(--bg)" }}
            >
              <table className="w-full border-collapse table-fixed">
                <thead
                  className="sticky top-0 border-b text-left"
                  style={{ background: "var(--surface)", borderColor: "var(--border)" }}
                >
                  <tr>
                    <th className="w-9 px-1.5 py-1 text-right opacity-50">#</th>
                    <th className="px-2 py-1 truncate">{fileNameOf(leftPath)}</th>
                    <th className="w-9 px-1.5 py-1 text-right opacity-50 border-l" style={{ borderColor: "var(--border)" }}>#</th>
                    <th className="px-2 py-1 truncate">{fileNameOf(rightPath)}</th>
                  </tr>
                </thead>
                <tbody>
                  {diff.rows.map((r, idx) => {
                    const leftBg =
                      r.kind === "removed"
                        ? "rgba(239, 68, 68, 0.22)"
                        : r.kind === "modified"
                        ? "rgba(245, 158, 11, 0.18)"
                        : "transparent";
                    const rightBg =
                      r.kind === "added"
                        ? "rgba(34, 197, 94, 0.22)"
                        : r.kind === "modified"
                        ? "rgba(245, 158, 11, 0.18)"
                        : "transparent";
                    return (
                      <tr key={idx} className="leading-5">
                        <td className="px-1.5 text-right opacity-45 select-none" style={{ background: leftBg }}>
                          {r.leftNum ?? ""}
                        </td>
                        <td
                          className="px-2 whitespace-pre-wrap break-all select-text"
                          style={{ background: leftBg }}
                        >
                          {r.leftText}
                        </td>
                        <td
                          className="px-1.5 text-right opacity-45 select-none border-l"
                          style={{ background: rightBg, borderColor: "var(--border)" }}
                        >
                          {r.rightNum ?? ""}
                        </td>
                        <td
                          className="px-2 whitespace-pre-wrap break-all select-text"
                          style={{ background: rightBg }}
                        >
                          {r.rightText}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* LIVE DUAL SIDE-BY-SIDE EDITORS */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-medium">
                  <span className="truncate">
                    {fileNameOf(leftPath)} {leftDirty && <span className="text-amber-400">●</span>}
                  </span>
                </div>
                <textarea
                  value={leftText}
                  onChange={(e) => {
                    setLeftText(e.target.value);
                    setLeftDirty(true);
                  }}
                  className="w-full h-[50vh] p-3 rounded-xl border font-mono text-xs nkf-scroll outline-none resize-none"
                  style={{
                    background: "var(--bg)",
                    borderColor: leftDirty ? "var(--accent)" : "var(--border)",
                    color: "var(--text)",
                  }}
                />
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px] font-medium">
                  <span className="truncate">
                    {fileNameOf(rightPath)} {rightDirty && <span className="text-amber-400">●</span>}
                  </span>
                </div>
                <textarea
                  value={rightText}
                  onChange={(e) => {
                    setRightText(e.target.value);
                    setRightDirty(true);
                  }}
                  className="w-full h-[50vh] p-3 rounded-xl border font-mono text-xs nkf-scroll outline-none resize-none"
                  style={{
                    background: "var(--bg)",
                    borderColor: rightDirty ? "var(--accent)" : "var(--border)",
                    color: "var(--text)",
                  }}
                />
              </div>
            </div>
          )}

          {/* Save Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {diff.added === 0 && diff.removed === 0 && diff.modified === 0 ? (
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <Check size={13} /> Files are 100% identical
                </span>
              ) : (
                "Edit in Live Dual Edit mode, then switch to Visual Diff to verify changes."
              )}
            </span>

            <div className="flex items-center gap-2">
              {leftDirty && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveSide("left")}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                  style={{ background: "var(--surface-alt)" }}
                >
                  <Save size={13} /> Save Left
                </button>
              )}
              {rightDirty && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveSide("right")}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer"
                  style={{ background: "var(--surface-alt)" }}
                >
                  <Save size={13} /> Save Right
                </button>
              )}
              {(leftDirty || rightDirty) && (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => saveSide("both")}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white cursor-pointer"
                >
                  <Save size={13} /> Save Both
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* BINARY / MIXED COMPARISON */
        <div className="py-10 text-center space-y-3 text-xs">
          <div className="font-semibold text-sm">Binary / Mixed File Comparison</div>
          <div className="grid grid-cols-2 gap-3 max-w-md mx-auto">
            <div className="p-3 rounded-xl border" style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}>
              <div className="font-medium truncate">{fileNameOf(leftPath)}</div>
              <div className="font-mono mt-1" style={{ color: "var(--text-muted)" }}>
                {leftPreview ? fmtBytes(leftPreview.size) : "—"}
              </div>
            </div>
            <div className="p-3 rounded-xl border" style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}>
              <div className="font-medium truncate">{fileNameOf(rightPath)}</div>
              <div className="font-mono mt-1" style={{ color: "var(--text-muted)" }}>
                {rightPreview ? fmtBytes(rightPreview.size) : "—"}
              </div>
            </div>
          </div>
        </div>
      )}
    </ModalDialog>
  );
};
