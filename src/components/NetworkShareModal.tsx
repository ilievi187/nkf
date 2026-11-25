import React, { useState } from "react";
import { Network, Loader2, Plug } from "lucide-react";
import { ModalDialog } from "./ModalDialog";
import { nkfApi } from "../lib/api";

interface NetworkShareModalProps {
  open: boolean;
  isWindows: boolean;
  onClose: () => void;
  onConnected: (mountedPath: string, remoteLabel: string) => void;
  onError: (msg: string) => void;
}

export const NetworkShareModal: React.FC<NetworkShareModalProps> = ({
  open,
  isWindows,
  onClose,
  onConnected,
  onError,
}) => {
  const [sharePath, setSharePath] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [driveLetter, setDriveLetter] = useState("AUTO");
  const [busy, setBusy] = useState(false);

  const handleConnect = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sharePath.trim()) return;
    setBusy(true);
    try {
      const mounted = await nkfApi.connectNetworkShare(
        sharePath.trim(),
        username.trim(),
        password,
        driveLetter
      );
      onConnected(mounted, sharePath.trim());
      setSharePath("");
      setUsername("");
      setPassword("");
      setDriveLetter("AUTO");
      onClose();
    } catch (err) {
      onError(String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Connect Network Share"
      subtitle={
        isWindows
          ? "Connect to a Windows SMB/UNC share (e.g. \\\\192.168.1.10\\Shared) or map it to a drive letter."
          : "Mount an SMB/SFTP share (e.g. smb://192.168.1.10/Shared) or add a local network mount path."
      }
    >
      <form onSubmit={handleConnect} className="space-y-4">
        <div>
          <label className="text-xs font-medium block mb-1" style={{ color: "var(--text-muted)" }}>
            Network Address
          </label>
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl border"
            style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
          >
            <Network size={15} style={{ color: "var(--accent)" }} />
            <input
              autoFocus
              required
              type="text"
              value={sharePath}
              onChange={(e) => setSharePath(e.target.value)}
              placeholder={isWindows ? "\\\\192.168.1.10\\Shared" : "smb://192.168.1.10/Shared"}
              className="flex-1 bg-transparent text-sm font-mono outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
              Username (optional)
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. user or DOMAIN\\user"
              className="w-full px-3 py-2 rounded-lg text-xs border"
              style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
            />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
              Password (optional)
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave empty for guest/saved"
              className="w-full px-3 py-2 rounded-lg text-xs border"
              style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
            />
          </div>
        </div>

        {isWindows && (
          <div>
            <label className="text-xs block mb-1" style={{ color: "var(--text-muted)" }}>
              Map to Drive Letter (optional)
            </label>
            <select
              value={driveLetter}
              onChange={(e) => setDriveLetter(e.target.value)}
              className="w-full px-3 py-2 rounded-lg text-xs border"
              style={{ background: "var(--surface-alt)", borderColor: "var(--border)" }}
            >
              <option value="AUTO">Direct UNC Path (no drive letter)</option>
              {["Z:", "Y:", "X:", "W:", "V:", "U:", "T:", "S:", "N:", "M:"].map((d) => (
                <option key={d} value={d}>
                  Map as {d}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium cursor-pointer"
            style={{ background: "var(--surface-alt)" }}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !sharePath.trim()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-40"
            style={{ background: "var(--accent)", color: "var(--accent-text)" }}
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
            Connect & Open
          </button>
        </div>
      </form>
    </ModalDialog>
  );
};
