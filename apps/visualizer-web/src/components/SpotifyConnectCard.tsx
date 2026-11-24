import { useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  HelpCircle,
  Link2,
  LogOut,
  Music2,
  RefreshCw,
} from "lucide-react";
import { getSpotifyRedirectUri } from "../services/spotify";
import type { NowPlayingMedia, SpotifyConnectionState } from "../types";

interface SpotifyConnectCardProps {
  spotify: SpotifyConnectionState;
  nowPlaying: NowPlayingMedia | null;
  onChangeClientId: (clientId: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onRefreshNowPlaying: () => void;
}

export function SpotifyConnectCard({
  spotify,
  nowPlaying,
  onChangeClientId,
  onConnect,
  onDisconnect,
  onRefreshNowPlaying,
}: SpotifyConnectCardProps) {
  const [copiedUri, setCopiedUri] = useState(false);
  const [showGuide, setShowGuide] = useState(!spotify.clientId && !spotify.connected);
  const redirectUri = getSpotifyRedirectUri();

  const handleCopyRedirect = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopiedUri(true);
      window.setTimeout(() => setCopiedUri(false), 2000);
    } catch {
      // Fallback ignored
    }
  };

  return (
    <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border-subtle)] space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{
              backgroundColor: spotify.connected ? "var(--accent)" : "var(--text-muted)",
            }}
          />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
              Spotify Live Song Recognition
            </div>
            <div className="text-[11px] text-[var(--text-muted)] truncate">
              {spotify.connected
                ? `Connected${spotify.userName ? ` as ${spotify.userName}` : ""} · Live Currently-Playing Sync`
                : "OAuth PKCE · Works on iPad Safari without any backend"}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setShowGuide((v) => !v)}
          className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--bg-base)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)] cursor-pointer shrink-0"
        >
          <HelpCircle className="w-3.5 h-3.5" />
          Setup
        </button>
      </div>

      {/* Live Track Preview when connected */}
      {spotify.connected && (
        <div className="flex items-center gap-2.5 p-2 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)]">
          {nowPlaying?.thumbnail_data_url ? (
            <img
              src={nowPlaying.thumbnail_data_url}
              alt=""
              className="w-10 h-10 rounded-md object-cover shrink-0 border border-[var(--border-subtle)]"
            />
          ) : (
            <div className="w-10 h-10 rounded-md bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center shrink-0">
              <Music2 className="w-4 h-4 text-[var(--accent)]" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            {nowPlaying?.title ? (
              <>
                <div className="text-xs font-semibold text-[var(--text-primary)] truncate">
                  {nowPlaying.title}
                </div>
                <div className="text-[11px] text-[var(--text-secondary)] truncate">
                  {nowPlaying.artist || nowPlaying.album || "Spotify"} ·{" "}
                  <span className="text-[var(--accent)]">
                    {nowPlaying.is_playing ? "Playing" : "Paused"}
                  </span>
                </div>
              </>
            ) : (
              <div className="text-[11px] text-[var(--text-muted)]">
                No active Spotify playback detected — start a track in Spotify on any device.
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onRefreshNowPlaying}
            className="p-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] cursor-pointer shrink-0"
            title="Poll Spotify now"
          >
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Client ID Input + Action Buttons */}
      <div className="space-y-2">
        <label className="block space-y-1">
          <span className="text-[11px] text-[var(--text-secondary)]">Spotify Client ID</span>
          <input
            type="text"
            value={spotify.clientId}
            onChange={(e) => onChangeClientId(e.target.value)}
            placeholder="e.g. 8a4f2c9b1e7d4a..."
            spellCheck={false}
            autoCapitalize="none"
            autoCorrect="off"
            className="w-full px-3 py-2 rounded-lg text-xs font-mono-num bg-[var(--bg-base)] border border-[var(--border-subtle)] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {spotify.connected ? (
            <>
              <button
                type="button"
                onClick={onConnect}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[var(--bg-base)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[var(--text-primary)] cursor-pointer"
              >
                <Link2 className="w-3.5 h-3.5 text-[var(--accent)]" />
                Reconnect
              </button>
              <button
                type="button"
                onClick={onDisconnect}
                className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[var(--bg-base)] hover:bg-rose-500/20 border border-[var(--border-subtle)] text-rose-400 cursor-pointer"
              >
                <LogOut className="w-3.5 h-3.5" />
                Disconnect
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={!spotify.clientId.trim() || spotify.connecting}
              onClick={onConnect}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-xs font-semibold cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
              style={{
                background: "var(--accent)",
                color: "var(--accent-contrast)",
              }}
            >
              <Link2 className="w-3.5 h-3.5" />
              {spotify.connecting ? "Redirecting to Spotify..." : "Connect Spotify Account"}
            </button>
          )}
        </div>
      </div>

      {spotify.error && (
        <div className="px-2.5 py-2 rounded-lg text-[11px] bg-rose-500/15 border border-rose-500/35 text-rose-300">
          {spotify.error}
        </div>
      )}

      {/* One-time 60-second setup guide */}
      {showGuide && (
        <div className="p-2.5 rounded-lg bg-[var(--bg-base)] border border-[var(--border-subtle)] space-y-2 text-[11px] text-[var(--text-secondary)]">
          <div className="font-semibold text-[var(--text-primary)]">
            1-Minute Free Spotify Setup (one-time)
          </div>
          <ol className="list-decimal list-inside space-y-1 leading-relaxed">
            <li>
              Open{" "}
              <a
                href="https://developer.spotify.com/dashboard"
                target="_blank"
                rel="noreferrer"
                className="text-[var(--accent)] underline inline-flex items-center gap-0.5"
              >
                Spotify Developer Dashboard
                <ExternalLink className="w-3 h-3" />
              </a>{" "}
              and click <strong>Create app</strong>.
            </li>
            <li>
              Select <strong>Web API</strong> and add this exact <strong>Redirect URI</strong>:
            </li>
          </ol>

          <div className="flex items-center gap-1.5">
            <code className="flex-1 px-2 py-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[10px] font-mono-num text-[var(--text-primary)] truncate select-all">
              {redirectUri}
            </code>
            <button
              type="button"
              onClick={() => void handleCopyRedirect()}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded bg-[var(--bg-surface)] hover:bg-[var(--bg-hover)] border border-[var(--border-subtle)] text-[10px] font-medium text-[var(--text-primary)] cursor-pointer shrink-0"
            >
              {copiedUri ? (
                <>
                  <Check className="w-3 h-3 text-[var(--accent)]" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  Copy
                </>
              )}
            </button>
          </div>

          <p className="text-[10px] text-[var(--text-muted)] leading-relaxed">
            3. Copy the <strong>Client ID</strong> (no Client Secret needed!) into the box above and
            tap <strong>Connect Spotify Account</strong>. Tip: you can also share a pre-filled link
            ending in <code>?spotify_client_id=YOUR_ID</code>.
          </p>
        </div>
      )}
    </div>
  );
}
