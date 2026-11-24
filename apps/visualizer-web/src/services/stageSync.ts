import type { NowPlayingMedia, VisualizerConfig } from "../types";

const CHANNEL_NAME = "t_visualizer_stage_sync_v1";

export type StageSyncMessage =
  | { type: "projector-hello"; id: string }
  | { type: "projector-heartbeat"; id: string }
  | { type: "projector-bye"; id: string }
  | {
      type: "state-sync";
      config: VisualizerConfig;
      nowPlaying: NowPlayingMedia | null;
      hasAudioSignal: boolean;
      blackout: boolean;
    }
  | {
      type: "fft-frame";
      bins: Uint8Array;
      hasAudioSignal: boolean;
    }
  | {
      type: "blackout";
      enabled: boolean;
    };

export function getProjectorUrl(): string {
  return `${window.location.origin}${window.location.pathname}?projector=1`;
}

export function isProjectorWindow(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("projector") === "1";
  } catch {
    return false;
  }
}

export function createStageChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

interface ScreenDetailLike {
  left: number;
  top: number;
  width: number;
  height: number;
  isPrimary?: boolean;
}

interface WindowWithScreenDetails extends Window {
  getScreenDetails?: () => Promise<{ screens: ScreenDetailLike[] }>;
}

/**
 * Opens the dedicated Beamer / Stage Projector window.
 * If the browser supports Multi-Screen Window Management (Chrome/Edge), opens directly
 * on the external/Beamer monitor; otherwise opens a clean popup ready to move to the Beamer
 * (including iPadOS Stage Manager / Extended External Display).
 */
export async function openProjectorWindow(): Promise<Window | null> {
  const url = getProjectorUrl();

  // Try opening directly on a secondary display if supported & permitted
  const winExt = window as unknown as WindowWithScreenDetails;
  if (typeof winExt.getScreenDetails === "function") {
    try {
      const details = await winExt.getScreenDetails();
      const external = details.screens.find((s) => !s.isPrimary);
      if (external) {
        const features = `popup=yes,left=${Math.round(external.left)},top=${Math.round(
          external.top
        )},width=${Math.round(external.width)},height=${Math.round(external.height)}`;
        const w = window.open(url, "t_visualizer_projector", features);
        if (w) return w;
      }
    } catch {
      // User declined multi-screen permission or unsupported; fall back to standard popup
    }
  }

  return window.open(
    url,
    "t_visualizer_projector",
    "popup=yes,width=1280,height=720,menubar=no,toolbar=no,location=no,status=no"
  );
}
