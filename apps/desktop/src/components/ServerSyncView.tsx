import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import {
  Check,
  CheckCircle2,
  Cloud,
  CloudUpload,
  Copy,
  Globe,
  Loader2,
  LogOut,
  RefreshCw,
  Server,
  ShieldCheck,
  Smartphone,
  Upload,
  UserPlus,
} from "lucide-react";
import { api } from "../services/api";
import type { ServerHealth, SyncProgressEvent, SyncSummary } from "../types";

interface ServerSyncViewProps {
  serverUrl: string;
  serverToken: string;
  serverUsername: string;
  serverRole: string;
  lastSyncAt: number | null;
  isSyncing: boolean;
  syncProgress: SyncProgressEvent | null;
  lastSyncSummary: SyncSummary | null;
  onAuthSuccess: () => Promise<void>;
  onLogout: () => Promise<void>;
  onSyncNow: () => Promise<void>;
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ServerSyncView({
  serverUrl,
  serverToken,
  serverUsername,
  serverRole,
  lastSyncAt,
  isSyncing,
  syncProgress,
  lastSyncSummary,
  onAuthSuccess,
  onLogout,
  onSyncNow,
}: ServerSyncViewProps) {
  const [urlInput, setUrlInput] = useState(serverUrl || "https://");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");

  const [checking, setChecking] = useState(false);
  const [health, setHealth] = useState<ServerHealth | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copiedPortal, setCopiedPortal] = useState(false);
  const [publishingPlatform, setPublishingPlatform] = useState<"android" | "windows" | null>(null);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);

  const isConnected = Boolean(serverToken && serverUrl);
  const cleanBaseUrl = serverUrl.replace(/\/+$/, "");
  const downloadsPortalUrl = `${cleanBaseUrl}/downloads`;

  const handleCopyPortal = async () => {
    try {
      await navigator.clipboard.writeText(downloadsPortalUrl);
      setCopiedPortal(true);
      window.setTimeout(() => setCopiedPortal(false), 1800);
    } catch {
      // Ignore clipboard failures on locked contexts
    }
  };

  const handlePublishArtifact = async (platform: "android" | "windows") => {
    setError(null);
    setPublishStatus(null);
    const selected = await open({
      multiple: false,
      title:
        platform === "android"
          ? "Select Android APK to publish to /downloads"
          : "Select Windows EXE to publish to /downloads",
      filters: [
        platform === "android"
          ? { name: "Android Installer", extensions: ["apk"] }
          : { name: "Windows Executable", extensions: ["exe"] },
      ],
    });
    if (!selected || Array.isArray(selected)) return;

    setPublishingPlatform(platform);
    try {
      const msg = await api.uploadAppDownload(platform, selected);
      setPublishStatus(msg);
    } catch (err) {
      setError(String(err));
    } finally {
      setPublishingPlatform(null);
    }
  };

  const handleTestConnection = async () => {
    setError(null);
    setHealth(null);
    setChecking(true);
    try {
      const h = await api.serverHealth(urlInput);
      setHealth(h);
    } catch (err) {
      setError(String(err));
    } finally {
      setChecking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await api.serverLogin(urlInput, username, password);
      } else {
        await api.serverRegister(
          urlInput,
          username,
          password,
          inviteCode.trim() || undefined
        );
      }
      setPassword("");
      await onAuthSuccess();
    } catch (err) {
      setError(String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6">
      <div className="max-w-3xl space-y-6">
        <div className="pb-4 border-b border-[var(--border-subtle)] flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-[10px] font-semibold uppercase tracking-widest px-2.5 py-1 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]">
              Multi-User Home Server Sync
            </span>
            <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)] mt-3">
              Home Server & Pixel Sync
            </h1>
            <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">
              Connect via Cloudflare Tunnel or LAN to upload local & WMP tracks, stream original quality anywhere, and two-way sync playlists & favorites with your Pixel 7.
            </p>
          </div>
        </div>

        {error && (
          <div className="px-4 py-3 rounded-xl bg-rose-500/15 border border-rose-500/30 text-xs text-rose-300">
            {error}
          </div>
        )}

        {isConnected ? (
          <div className="space-y-4">
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-5">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[var(--accent-soft)] flex items-center justify-center">
                    <Cloud className="w-5 h-5 text-[var(--accent)]" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-[var(--text-primary)]">
                        {serverUsername}
                      </span>
                      <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--accent)]">
                        {serverRole || "user"}
                      </span>
                    </div>
                    <div className="text-xs font-mono-num text-[var(--text-secondary)] mt-0.5">
                      {serverUrl}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void onSyncNow()}
                    disabled={isSyncing}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold disabled:opacity-50 cursor-pointer"
                    style={{
                      background: "var(--accent)",
                      color: "var(--accent-contrast)",
                    }}
                  >
                    <RefreshCw
                      className={`w-3.5 h-3.5 ${isSyncing ? "animate-spin" : ""}`}
                    />
                    {isSyncing
                      ? `Syncing ${syncProgress?.percent ?? 0}%`
                      : "Sync Now"}
                  </button>

                  <button
                    type="button"
                    onClick={() => void onLogout()}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-secondary)] cursor-pointer"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Sign Out
                  </button>
                </div>
              </div>

              {(isSyncing ||
                (syncProgress &&
                  syncProgress.phase !== "done" &&
                  syncProgress.phase !== "error")) && (
                <div className="p-3.5 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-[var(--text-primary)] truncate">
                      {syncProgress?.message || "Syncing library…"}
                    </span>
                    <span className="font-mono-num font-bold text-[var(--accent)] shrink-0">
                      {syncProgress?.percent ?? 0}%
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[var(--bg-hover)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-[width] duration-150"
                      style={{
                        width: `${Math.min(100, Math.max(2, syncProgress?.percent ?? 0))}%`,
                        background: "var(--accent)",
                      }}
                    />
                  </div>
                  {(syncProgress?.file_name || (syncProgress?.bytes_total ?? 0) > 0) && (
                    <div className="flex items-center justify-between gap-3 text-[11px] text-[var(--text-muted)]">
                      <span className="truncate">
                        {syncProgress?.file_name ?? ""}
                      </span>
                      {(syncProgress?.bytes_total ?? 0) > 0 && (
                        <span className="font-mono-num shrink-0">
                          {formatMb(syncProgress?.bytes_sent ?? 0)} /{" "}
                          {formatMb(syncProgress?.bytes_total ?? 0)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}

              <div className="grid sm:grid-cols-2 gap-3 pt-3 border-t border-[var(--border-subtle)] text-xs">
                <div className="px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface)]">
                  <div className="text-[11px] text-[var(--text-muted)]">Last Synced</div>
                  <div className="font-mono-num text-[var(--text-primary)] mt-0.5">
                    {lastSyncAt
                      ? new Date(lastSyncAt * 1000).toLocaleString()
                      : "Never synced yet — click Sync Now"}
                  </div>
                </div>
                <div className="px-3.5 py-2.5 rounded-xl bg-[var(--bg-surface)]">
                  <div className="text-[11px] text-[var(--text-muted)]">Latest Result</div>
                  <div className="font-mono-num text-[var(--text-primary)] mt-0.5">
                    {lastSyncSummary
                      ? `+${lastSyncSummary.uploaded_tracks} up · +${lastSyncSummary.pulled_tracks} down · ${lastSyncSummary.synced_playlists} playlists`
                      : "Ready for two-way sync"}
                  </div>
                </div>
              </div>
            </div>

            {/* Self-Hosted Download Page Card */}
            <div className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-3">
              <div className="flex items-center gap-2">
                <Globe className="w-4 h-4 text-[var(--accent)]" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  Self-Hosted App Download Page
                </span>
              </div>
              <p className="text-xs text-[var(--text-secondary)]">
                Share this URL on the exact same domain so friends can download the Pixel/Android APK or Windows app directly from your server:
              </p>

              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)]">
                <code className="flex-1 text-xs font-mono-num text-[var(--accent)] truncate">
                  {downloadsPortalUrl}
                </code>
                <button
                  type="button"
                  onClick={() => void handleCopyPortal()}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium bg-[var(--bg-elevated)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer"
                >
                  {copiedPortal ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-[var(--accent)]" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      Copy Link
                    </>
                  )}
                </button>
              </div>

              {serverRole === "admin" && (
                <div className="pt-1 flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={publishingPlatform !== null}
                    onClick={() => void handlePublishArtifact("android")}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] disabled:opacity-50 cursor-pointer"
                  >
                    {publishingPlatform === "android" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
                    ) : (
                      <Upload className="w-3.5 h-3.5 text-[var(--accent)]" />
                    )}
                    Publish Android APK
                  </button>

                  <button
                    type="button"
                    disabled={publishingPlatform !== null}
                    onClick={() => void handlePublishArtifact("windows")}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] disabled:opacity-50 cursor-pointer"
                  >
                    {publishingPlatform === "windows" ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
                    ) : (
                      <Upload className="w-3.5 h-3.5 text-[var(--accent)]" />
                    )}
                    Publish Windows EXE
                  </button>
                </div>
              )}

              {publishStatus && (
                <div className="text-xs text-emerald-400 font-medium">
                  {publishStatus}
                </div>
              )}
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="p-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-4"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Server className="w-4 h-4 text-[var(--accent)]" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">
                  Connect to Your Server
                </span>
              </div>

              <div className="flex items-center gap-1 p-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-xs">
                <button
                  type="button"
                  onClick={() => setMode("login")}
                  className={`px-3 py-1 rounded-md font-medium cursor-pointer ${
                    mode === "login"
                      ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                      : "text-[var(--text-secondary)]"
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setMode("register")}
                  className={`px-3 py-1 rounded-md font-medium flex items-center gap-1 cursor-pointer ${
                    mode === "register"
                      ? "bg-[var(--accent)] text-[var(--accent-contrast)]"
                      : "text-[var(--text-secondary)]"
                  }`}
                >
                  <UserPlus className="w-3 h-3" />
                  Create Account
                </button>
              </div>
            </div>

            {/* Server URL + Test */}
            <div>
              <span className="text-[11px] text-[var(--text-muted)]">
                Server URL (Cloudflare Tunnel HTTPS or LAN HTTP)
              </span>
              <div className="mt-1 flex gap-2">
                <input
                  type="url"
                  required
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://music.yourdomain.com"
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-mono-num bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={() => void handleTestConnection()}
                  disabled={checking}
                  className="px-3.5 py-2 rounded-lg text-xs font-medium bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] flex items-center gap-1.5 cursor-pointer"
                >
                  {checking && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Test
                </button>
              </div>
              {health && (
                <div className="mt-1.5 flex items-center gap-2 text-[11px] text-emerald-400">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  Connected · Server v{health.version}
                  {health.invite_required ? " · Invite code required" : ""}
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[11px] text-[var(--text-muted)]">Username</span>
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="tristan"
                  className="mt-1 w-full px-3 py-2 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </label>

              <label className="block">
                <span className="text-[11px] text-[var(--text-muted)]">Password</span>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="mt-1 w-full px-3 py-2 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </label>
            </div>

            {mode === "register" && (
              <label className="block">
                <span className="text-[11px] text-[var(--text-muted)]">
                  Invite Code (optional unless configured in server .env)
                </span>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="Leave blank if open registration"
                  className="mt-1 w-full px-3 py-2 rounded-lg text-xs font-mono-num bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent)]"
                />
              </label>
            )}

            <div className="flex justify-end pt-1">
              <button
                type="submit"
                disabled={submitting}
                className="flex items-center gap-2 px-5 py-2 rounded-xl text-xs font-semibold disabled:opacity-50 cursor-pointer"
                style={{
                  background: "var(--accent)",
                  color: "var(--accent-contrast)",
                }}
              >
                {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {mode === "login" ? "Sign In & Connect" : "Register & Connect"}
              </button>
            </div>
          </form>
        )}

        {/* Setup Guide Cards */}
        <div className="grid sm:grid-cols-3 gap-3">
          <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-400" />
            <div className="text-xs font-semibold text-[var(--text-primary)]">
              1 · Deploy Docker Server
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Copy <span className="font-mono-num">server/.env.example</span> to{" "}
              <span className="font-mono-num">server/.env</span> and run{" "}
              <span className="font-mono-num">docker compose up -d --build</span>.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-2">
            <CloudUpload className="w-5 h-5 text-[var(--accent)]" />
            <div className="text-xs font-semibold text-[var(--text-primary)]">
              2 · Cloudflare Tunnel
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Route your domain (e.g.{" "}
              <span className="font-mono-num">https://music.yourdomain.com</span>) to{" "}
              <span className="font-mono-num">http://localhost:8484</span>.
            </p>
          </div>

          <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] space-y-2">
            <Smartphone className="w-5 h-5 text-[var(--accent)]" />
            <div className="text-xs font-semibold text-[var(--text-primary)]">
              3 · Pixel 7 Offline & Sync
            </div>
            <p className="text-[11px] text-[var(--text-secondary)] leading-relaxed">
              Sign in with the same URL & account on Android to download tracks/playlists offline and sync changes both ways.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
