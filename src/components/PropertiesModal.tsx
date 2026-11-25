import React, { useEffect, useState } from "react";
import { Copy, Check, ShieldCheck, ShieldAlert, Loader2, Hash } from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { fmtBytes, fmtDate, nkfApi, type FileProperties } from "../lib/api";

interface PropertiesModalProps {
  path: string | null;
  onClose: () => void;
}

export const PropertiesModal: React.FC<PropertiesModalProps> = ({ path, onClose }) => {
  const [props, setProps] = useState<FileProperties | null>(null);
  const [loading, setLoading] = useState(false);
  const [hashing, setHashing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [compareHash, setCompareHash] = useState("");

  useEffect(() => {
    if (!path) return;
    setLoading(true);
    setProps(null);
    setCompareHash("");
    nkfApi
      .getFileProperties(path, false)
      .then(setProps)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [path]);

  const computeSha = async () => {
    if (!path) return;
    setHashing(true);
    try {
      const updated = await nkfApi.getFileProperties(path, true);
      setProps(updated);
    } finally {
      setHashing(false);
    }
  };

  const copyText = (text: string) => {
    navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const normalizedCompare = compareHash.trim().toLowerCase();
  const hashMatches =
    Boolean(props?.sha256) &&
    normalizedCompare.length > 0 &&
    props?.sha256?.toLowerCase() === normalizedCompare;

  return (
    <ModalDialog
      open={Boolean(path)}
      onClose={onClose}
      title={props ? props.name : "Properties"}
      subtitle={props ? (props.is_dir ? "Folder Properties" : "File Properties & Checksum") : ""}
    >
      {loading || !props ? (
        <div className="py-10 flex items-center justify-center gap-2 text-xs" style={{ color: "var(--text-muted)" }}>
          <Loader2 size={16} className="animate-spin" /> Inspecting...
        </div>
      ) : (
        <div className="space-y-4 text-xs">
          <div
            className="rounded-xl border divide-y"
            style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
          >
            <div className="px-3.5 py-2.5 flex items-center justify-between gap-2" style={{ borderColor: "var(--border)" }}>
              <span style={{ color: "var(--text-muted)" }}>Full Path</span>
              <div className="flex items-center gap-1.5 min-w-0">
                <span className="font-mono truncate max-w-[340px]" title={props.path}>
                  {props.path}
                </span>
                <button
                  type="button"
                  onClick={() => copyText(props.path)}
                  className="p-1 rounded hover:bg-white/10 cursor-pointer shrink-0"
                  title="Copy path"
                >
                  {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                </button>
              </div>
            </div>
            <div className="px-3.5 py-2.5 flex justify-between" style={{ borderColor: "var(--border)" }}>
              <span style={{ color: "var(--text-muted)" }}>Size</span>
              <span className="font-mono">
                {fmtBytes(props.size)} ({props.size.toLocaleString()} bytes)
              </span>
            </div>
            {props.is_dir && (
              <div className="px-3.5 py-2.5 flex justify-between" style={{ borderColor: "var(--border)" }}>
                <span style={{ color: "var(--text-muted)" }}>Contains</span>
                <span>{props.item_count.toLocaleString()} items</span>
              </div>
            )}
            <div className="px-3.5 py-2.5 flex justify-between" style={{ borderColor: "var(--border)" }}>
              <span style={{ color: "var(--text-muted)" }}>Modified</span>
              <span>{fmtDate(props.modified_ms)}</span>
            </div>
            <div className="px-3.5 py-2.5 flex justify-between" style={{ borderColor: "var(--border)" }}>
              <span style={{ color: "var(--text-muted)" }}>Created</span>
              <span>{fmtDate(props.created_ms)}</span>
            </div>
            <div className="px-3.5 py-2.5 flex justify-between" style={{ borderColor: "var(--border)" }}>
              <span style={{ color: "var(--text-muted)" }}>Read-only</span>
              <span>{props.readonly ? "Yes" : "No"}</span>
            </div>
          </div>

          {!props.is_dir && (
            <div
              className="rounded-xl border p-3.5 space-y-2.5"
              style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold flex items-center gap-1.5">
                  <Hash size={14} style={{ color: "var(--accent)" }} /> SHA-256 Checksum
                </span>
                {!props.sha256 && (
                  <button
                    type="button"
                    disabled={hashing}
                    onClick={computeSha}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer"
                    style={{ background: "var(--accent)", color: "var(--accent-text)" }}
                  >
                    {hashing && <Loader2 size={12} className="animate-spin" />}
                    Compute SHA-256
                  </button>
                )}
              </div>

              {props.sha256 && (
                <>
                  <div className="flex items-center gap-2">
                    <code
                      className="flex-1 p-2 rounded-lg text-[11px] font-mono break-all select-text"
                      style={{ background: "var(--bg)" }}
                    >
                      {props.sha256}
                    </code>
                    <button
                      type="button"
                      onClick={() => copyText(props.sha256!)}
                      className="p-2 rounded-lg cursor-pointer"
                      style={{ background: "var(--surface)" }}
                      title="Copy SHA-256"
                    >
                      <Copy size={13} />
                    </button>
                  </div>

                  <input
                    type="text"
                    value={compareHash}
                    onChange={(e) => setCompareHash(e.target.value)}
                    placeholder="Paste expected SHA-256 to verify..."
                    className="w-full px-3 py-1.5 rounded-lg text-xs font-mono border"
                    style={{ background: "var(--bg)", borderColor: "var(--border)" }}
                  />

                  {normalizedCompare && (
                    <div
                      className={`flex items-center gap-1.5 text-xs font-medium ${
                        hashMatches ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {hashMatches ? (
                        <>
                          <ShieldCheck size={15} /> Checksum matches 100%!
                        </>
                      ) : (
                        <>
                          <ShieldAlert size={15} /> Checksum mismatch!
                        </>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </ModalDialog>
  );
};
