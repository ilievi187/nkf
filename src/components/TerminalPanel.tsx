import React, { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { Terminal, X, RotateCw, FolderSync } from "lucide-react";
import { nkfApi } from "../lib/api";

interface TerminalPanelProps {
  open: boolean;
  cwd: string;
  platform: string;
  onClose: () => void;
}

export const TerminalPanel: React.FC<TerminalPanelProps> = ({
  open,
  cwd,
  platform,
  onClose,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const spawnedRef = useRef(false);
  const lastCwdRef = useRef<string>("");

  const [height, setHeight] = useState(235);
  const [followCwd, setFollowCwd] = useState(true);
  const [restartKey, setRestartKey] = useState(0);

  // Initialize xterm + PTY when opened
  useEffect(() => {
    if (!open || !hostRef.current) return;

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 12.5,
      fontFamily: "JetBrains Mono, Cascadia Code, Consolas, monospace",
      theme: {
        background: "#0d1017",
        foreground: "#e5e9f0",
        cursor: "#38bdf8",
        selectionBackground: "rgba(56, 189, 248, 0.30)",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    const dataSub = term.onData((data) => {
      nkfApi.ptyWrite(data).catch(() => {});
    });

    let unlistenOut: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;
    let disposed = false;

    (async () => {
      unlistenOut = await listen<string>("pty-output", (ev) => {
        if (!disposed) term.write(ev.payload);
      });
      unlistenExit = await listen("pty-exit", () => {
        if (!disposed) {
          term.writeln("\r\n\x1b[90m[Shell exited — click Restart to open a new session]\x1b[0m");
          spawnedRef.current = false;
        }
      });

      const cols = term.cols || 100;
      const rows = term.rows || 14;
      try {
        await nkfApi.ptySpawn(cwd, cols, rows);
        spawnedRef.current = true;
        lastCwdRef.current = cwd;
      } catch (err) {
        term.writeln(`\x1b[31mFailed to start terminal: ${String(err)}\x1b[0m`);
      }
    })();

    const ro = new ResizeObserver(() => {
      if (!fitRef.current || !termRef.current) return;
      try {
        fitRef.current.fit();
        nkfApi.ptyResize(termRef.current.cols, termRef.current.rows).catch(() => {});
      } catch {
        // ignore resize race
      }
    });
    ro.observe(hostRef.current);

    return () => {
      disposed = true;
      ro.disconnect();
      dataSub.dispose();
      if (unlistenOut) unlistenOut();
      if (unlistenExit) unlistenExit();
      nkfApi.ptyClose().catch(() => {});
      spawnedRef.current = false;
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
  }, [open, restartKey]);

  // Follow active pane folder changes (like Dolphin F4)
  useEffect(() => {
    if (!open || !followCwd || !spawnedRef.current || !cwd) return;
    if (cwd === lastCwdRef.current) return;
    lastCwdRef.current = cwd;
    const escaped =
      platform === "windows"
        ? `cd '${cwd.replace(/'/g, "''")}'\r`
        : `cd '${cwd.replace(/'/g, "'\\''")}'\r`;
    nkfApi.ptyWrite(escaped).catch(() => {});
  }, [cwd, open, followCwd, platform]);

  if (!open) return null;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const onMove = (ev: MouseEvent) => {
      const next = Math.max(130, Math.min(window.innerHeight * 0.65, startH + (startY - ev.clientY)));
      setHeight(next);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className="border-t flex flex-col shrink-0"
      style={{
        height,
        background: "#0d1017",
        borderColor: "var(--border)",
      }}
    >
      {/* Drag resize handle */}
      <div
        onMouseDown={startResize}
        className="h-1 cursor-row-resize hover:bg-sky-500/50 transition-colors"
        title="Drag to resize terminal"
      />
      {/* Header */}
      <div
        className="h-7 px-3 border-b flex items-center justify-between text-[11px] shrink-0"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Terminal size={13} style={{ color: "var(--accent)" }} />
          <span className="font-semibold">Integrated Terminal</span>
          <span className="truncate font-mono text-[10px]" style={{ color: "var(--text-muted)" }}>
            {cwd}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setFollowCwd((v) => !v)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium cursor-pointer"
            style={{
              background: followCwd ? "var(--accent)" : "var(--surface-alt)",
              color: followCwd ? "var(--accent-text)" : "var(--text-muted)",
            }}
            title="Automatically cd when navigating folders"
          >
            <FolderSync size={11} /> Follow Folder
          </button>
          <button
            type="button"
            onClick={() => setRestartKey((k) => k + 1)}
            className="p-1 rounded hover:bg-white/10 cursor-pointer"
            title="Restart shell"
          >
            <RotateCw size={12} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded hover:bg-white/10 cursor-pointer"
            title="Close Terminal (F4)"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* xterm host */}
      <div ref={hostRef} className="flex-1 min-h-0 px-2 py-1 overflow-hidden" />
    </div>
  );
};
