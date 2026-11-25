import React, { useEffect, useMemo, useState } from "react";
import { Search, Command } from "lucide-react";
import { ModalDialog } from "./ModalDialog";

export interface PaletteCommand {
  id: string;
  label: string;
  category: string;
  shortcut?: string;
  run: () => void;
}

interface CommandPaletteProps {
  open: boolean;
  commands: PaletteCommand[];
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ open, commands, onClose }) => {
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIdx(0);
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands.slice(0, 30);
    return commands
      .filter(
        (c) =>
          c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [commands, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  const execute = (cmd?: PaletteCommand) => {
    if (!cmd) return;
    onClose();
    cmd.run();
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Command Palette"
      subtitle="Jump to folders, network shares, themes, or tools (Ctrl+K)"
    >
      <div className="space-y-3">
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-xl border"
          style={{ background: "var(--surface-alt)", borderColor: "var(--accent)" }}
        >
          <Search size={15} style={{ color: "var(--accent)" }} />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(filtered.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter") {
                e.preventDefault();
                execute(filtered[activeIdx]);
              }
            }}
            placeholder="Type a folder, action, or theme..."
            className="flex-1 bg-transparent text-sm outline-none"
          />
        </div>

        <div className="max-h-72 overflow-y-auto nkf-scroll space-y-0.5">
          {filtered.length === 0 ? (
            <div className="py-8 text-center text-xs" style={{ color: "var(--text-muted)" }}>
              No matching commands.
            </div>
          ) : (
            filtered.map((cmd, idx) => (
              <button
                key={cmd.id}
                type="button"
                onClick={() => execute(cmd)}
                onMouseEnter={() => setActiveIdx(idx)}
                className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs text-left cursor-pointer"
                style={{
                  background: idx === activeIdx ? "var(--surface-hover)" : "transparent",
                }}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Command size={13} style={{ color: "var(--accent)" }} className="shrink-0" />
                  <span className="truncate font-medium">{cmd.label}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{ background: "var(--surface-alt)", color: "var(--text-muted)" }}
                  >
                    {cmd.category}
                  </span>
                  {cmd.shortcut && (
                    <kbd
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded border"
                      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                    >
                      {cmd.shortcut}
                    </kbd>
                  )}
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </ModalDialog>
  );
};
