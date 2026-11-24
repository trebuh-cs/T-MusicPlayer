import type { NowPlayingMedia } from "../types";

const STORAGE_CLIENT_ID = "t_viz_web_spotify_client_id_v1";
const STORAGE_TOKENS = "t_viz_web_spotify_tokens_v1";
const STORAGE_PKCE = "t_viz_web_spotify_pkce_v1";

const SPOTIFY_AUTHORIZE_URL = "https://accounts.spotify.com/authorize";
const SPOTIFY_TOKEN_URL = "https://accounts.spotify.com/api/token";
const SPOTIFY_CURRENTLY_PLAYING_URL =
  "https://api.spotify.com/v1/me/player/currently-playing?additional_types=track,episode";
const SPOTIFY_ME_URL = "https://api.spotify.com/v1/me";
const SPOTIFY_SCOPES = "user-read-currently-playing user-read-playback-state";

interface StoredSpotifyTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  clientId: string;
  userName: string | null;
}

interface StoredPkcePending {
  verifier: string;
  state: string;
  clientId: string;
  redirectUri: string;
  createdAt: number;
}

let inflightRefresh: Promise<StoredSpotifyTokens | null> | null = null;
let rateLimitedUntil = 0;

export function getSpotifyRedirectUri(): string {
  // Always strip query & hash so redirect_uri matches the Spotify Developer Dashboard entry exactly
  return `${window.location.origin}${window.location.pathname}`;
}

export function loadSavedSpotifyClientId(): string {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get("spotify_client_id")?.trim();
    if (fromUrl) {
      localStorage.setItem(STORAGE_CLIENT_ID, fromUrl);
      return fromUrl;
    }
    return localStorage.getItem(STORAGE_CLIENT_ID)?.trim() || "";
  } catch {
    return "";
  }
}

export function saveSpotifyClientId(clientId: string): void {
  const cleaned = clientId.trim();
  try {
    if (cleaned) {
      localStorage.setItem(STORAGE_CLIENT_ID, cleaned);
    } else {
      localStorage.removeItem(STORAGE_CLIENT_ID);
    }
  } catch {
    // Ignore storage quota errors
  }
}

export function loadStoredSpotifyTokens(): StoredSpotifyTokens | null {
  try {
    const raw = localStorage.getItem(STORAGE_TOKENS);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSpotifyTokens>;
    if (!parsed.accessToken || !parsed.clientId) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken ?? null,
      expiresAt: typeof parsed.expiresAt === "number" ? parsed.expiresAt : 0,
      clientId: parsed.clientId,
      userName: parsed.userName ?? null,
    };
  } catch {
    return null;
  }
}

function saveStoredSpotifyTokens(tokens: StoredSpotifyTokens): void {
  try {
    localStorage.setItem(STORAGE_TOKENS, JSON.stringify(tokens));
  } catch {
    // Ignore
  }
}

export function disconnectSpotify(): void {
  try {
    localStorage.removeItem(STORAGE_TOKENS);
    localStorage.removeItem(STORAGE_PKCE);
  } catch {
    // Ignore
  }
  rateLimitedUntil = 0;
}

function randomBase64Url(byteLen: number): string {
  const bytes = new Uint8Array(byteLen);
  crypto.getRandomValues(bytes);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256Base64Url(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(digest);
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Initiates Spotify OAuth 2.0 Authorization Code Flow with PKCE (zero backend / zero client secret).
 */
export async function startSpotifyLogin(clientId: string): Promise<void> {
  const cleaned = clientId.trim();
  if (!cleaned) {
    throw new Error("Please enter your Spotify Client ID first.");
  }
  if (!crypto?.subtle) {
    throw new Error("HTTPS (Secure Context) is required for Spotify PKCE login.");
  }

  saveSpotifyClientId(cleaned);

  const verifier = randomBase64Url(48);
  const challenge = await sha256Base64Url(verifier);
  const state = randomBase64Url(16);
  const redirectUri = getSpotifyRedirectUri();

  const pending: StoredPkcePending = {
    verifier,
    state,
    clientId: cleaned,
    redirectUri,
    createdAt: Date.now(),
  };
  localStorage.setItem(STORAGE_PKCE, JSON.stringify(pending));

  const params = new URLSearchParams({
    client_id: cleaned,
    response_type: "code",
    redirect_uri: redirectUri,
    code_challenge_method: "S256",
    code_challenge: challenge,
    state,
    scope: SPOTIFY_SCOPES,
  });

  window.location.assign(`${SPOTIFY_AUTHORIZE_URL}?${params.toString()}`);
}

async function fetchProfileName(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(SPOTIFY_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { display_name?: string; id?: string };
    return data.display_name || data.id || null;
  } catch {
    return null;
  }
}

/**
 * Handles the Spotify OAuth callback (`?code=...&state=...`) on app load if present.
 * Returns `{ handled, tokens, error }`.
 */
export async function handleSpotifyCallbackIfPresent(): Promise<{
  handled: boolean;
  tokens: StoredSpotifyTokens | null;
  error: string | null;
}> {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const state = params.get("state");
  const oauthError = params.get("error");

  if (!code && !oauthError) {
    return { handled: false, tokens: loadStoredSpotifyTokens(), error: null };
  }

  // Clean URL immediately so reloads never reuse an expired authorization code
  const cleanUrl = getSpotifyRedirectUri();
  window.history.replaceState({}, document.title, cleanUrl);

  if (oauthError) {
    localStorage.removeItem(STORAGE_PKCE);
    return {
      handled: true,
      tokens: null,
      error: `Spotify login canceled or denied (${oauthError}).`,
    };
  }

  let pending: StoredPkcePending | null = null;
  try {
    const raw = localStorage.getItem(STORAGE_PKCE);
    if (raw) pending = JSON.parse(raw) as StoredPkcePending;
  } catch {
    pending = null;
  }
  localStorage.removeItem(STORAGE_PKCE);

  if (!pending || !pending.verifier || !pending.clientId) {
    return {
      handled: true,
      tokens: null,
      error: "Spotify login session expired. Please tap Connect Spotify again.",
    };
  }
  if (state && pending.state && state !== pending.state) {
    return {
      handled: true,
      tokens: null,
      error: "Spotify OAuth state mismatch. Please try connecting again.",
    };
  }

  const body = new URLSearchParams({
    client_id: pending.clientId,
    grant_type: "authorization_code",
    code: code!,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
  });

  const res = await fetch(SPOTIFY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const errJson = (await res.json()) as { error_description?: string; error?: string };
      detail = errJson.error_description || errJson.error || detail;
    } catch {
      // Ignore parse error
    }
    return {
      handled: true,
      tokens: null,
      error: `Spotify token exchange failed: ${detail}`,
    };
  }

  const json = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };

  const userName = await fetchProfileName(json.access_token);
  const tokens: StoredSpotifyTokens = {
    accessToken: json.access_token,
    refreshToken: json.refresh_token ?? null,
    expiresAt: Date.now() + Math.max(60, json.expires_in ?? 3600) * 1000,
    clientId: pending.clientId,
    userName,
  };
  saveStoredSpotifyTokens(tokens);

  return { handled: true, tokens, error: null };
}

async function refreshAccessToken(current: StoredSpotifyTokens): Promise<StoredSpotifyTokens | null> {
  if (!current.refreshToken) {
    disconnectSpotify();
    return null;
  }
  if (inflightRefresh) {
    return inflightRefresh;
  }

  inflightRefresh = (async () => {
    try {
      const body = new URLSearchParams({
        client_id: current.clientId,
        grant_type: "refresh_token",
        refresh_token: current.refreshToken!,
      });
      const res = await fetch(SPOTIFY_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      if (!res.ok) {
        if (res.status === 400 || res.status === 401) {
          disconnectSpotify();
        }
        return null;
      }
      const json = (await res.json()) as {
        access_token: string;
        refresh_token?: string;
        expires_in?: number;
      };
      const updated: StoredSpotifyTokens = {
        accessToken: json.access_token,
        refreshToken: json.refresh_token || current.refreshToken,
        expiresAt: Date.now() + Math.max(60, json.expires_in ?? 3600) * 1000,
        clientId: current.clientId,
        userName: current.userName,
      };
      saveStoredSpotifyTokens(updated);
      return updated;
    } catch {
      return null;
    } finally {
      inflightRefresh = null;
    }
  })();

  return inflightRefresh;
}

async function getValidTokens(forceRefresh = false): Promise<StoredSpotifyTokens | null> {
  const stored = loadStoredSpotifyTokens();
  if (!stored) return null;
  const needsRefresh = forceRefresh || Date.now() >= stored.expiresAt - 120_000;
  if (!needsRefresh) return stored;
  return refreshAccessToken(stored);
}

interface SpotifyCurrentlyPlayingResponse {
  is_playing?: boolean;
  currently_playing_type?: string;
  item?: {
    name?: string;
    artists?: Array<{ name?: string }>;
    album?: {
      name?: string;
      images?: Array<{ url?: string; width?: number }>;
    };
    show?: {
      name?: string;
      publisher?: string;
      images?: Array<{ url?: string; width?: number }>;
    };
    images?: Array<{ url?: string; width?: number }>;
  } | null;
}

export interface SpotifyPollResult {
  connected: boolean;
  media: NowPlayingMedia | null;
  error: string | null;
}

/**
 * Polls Spotify's `currently-playing` endpoint and converts the live track into NowPlayingMedia.
 */
export async function pollSpotifyNowPlaying(): Promise<SpotifyPollResult> {
  if (Date.now() < rateLimitedUntil) {
    return { connected: Boolean(loadStoredSpotifyTokens()), media: null, error: null };
  }

  let tokens = await getValidTokens(false);
  if (!tokens) {
    return { connected: false, media: null, error: null };
  }

  const doRequest = (accessToken: string) =>
    fetch(SPOTIFY_CURRENTLY_PLAYING_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

  try {
    let res = await doRequest(tokens.accessToken);

    if (res.status === 401) {
      tokens = await getValidTokens(true);
      if (!tokens) {
        return {
          connected: false,
          media: null,
          error: "Spotify session expired. Please reconnect.",
        };
      }
      res = await doRequest(tokens.accessToken);
    }

    if (res.status === 429) {
      const retrySec = Number(res.headers.get("Retry-After") || "5");
      rateLimitedUntil = Date.now() + Math.max(3, retrySec) * 1000;
      return { connected: true, media: null, error: null };
    }

    if (res.status === 204) {
      return { connected: true, media: null, error: null };
    }

    if (!res.ok) {
      return {
        connected: true,
        media: null,
        error: `Spotify API error (HTTP ${res.status})`,
      };
    }

    const data = (await res.json()) as SpotifyCurrentlyPlayingResponse;
    const item = data.item;
    if (!item || !item.name) {
      return { connected: true, media: null, error: null };
    }

    const artists =
      item.artists
        ?.map((a) => a.name?.trim())
        .filter(Boolean)
        .join(", ") ||
      item.show?.publisher ||
      item.show?.name ||
      "";

    const album = item.album?.name || item.show?.name || "";
    const images = item.album?.images || item.images || item.show?.images || [];
    const bestImg = images[0]?.url ?? null;

    return {
      connected: true,
      media: {
        title: item.name,
        artist: artists,
        album,
        source_app: "Spotify",
        is_playing: Boolean(data.is_playing),
        thumbnail_data_url: bestImg,
      },
      error: null,
    };
  } catch (err) {
    return {
      connected: true,
      media: null,
      error: err instanceof Error ? err.message : "Network error reaching Spotify",
    };
  }
}
