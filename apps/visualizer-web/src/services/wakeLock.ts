/**
 * Screen Wake Lock controller so the iPad / tablet stays awake during live festival sets.
 * Automatically re-acquires the wake lock whenever Safari returns to the foreground.
 */
interface WakeLockSentinelLike {
  released: boolean;
  release: () => Promise<void>;
  addEventListener?: (type: string, listener: () => void) => void;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request: (type: "screen") => Promise<WakeLockSentinelLike>;
  };
}

export class ScreenWakeLockController {
  private sentinel: WakeLockSentinelLike | null = null;
  private wanted = false;
  private onChange: (active: boolean) => void;

  constructor(onChange: (active: boolean) => void) {
    this.onChange = onChange;
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  static isSupported(): boolean {
    return Boolean((navigator as unknown as NavigatorWithWakeLock).wakeLock?.request);
  }

  private handleVisibility = () => {
    if (document.visibilityState === "visible" && this.wanted && !this.sentinel) {
      void this.acquire();
    }
  };

  async enable(): Promise<boolean> {
    this.wanted = true;
    return this.acquire();
  }

  private async acquire(): Promise<boolean> {
    const api = (navigator as unknown as NavigatorWithWakeLock).wakeLock;
    if (!api?.request) {
      this.onChange(false);
      return false;
    }
    try {
      const s = await api.request("screen");
      this.sentinel = s;
      this.onChange(true);
      s.addEventListener?.("release", () => {
        if (this.sentinel === s) {
          this.sentinel = null;
          this.onChange(false);
        }
      });
      return true;
    } catch {
      this.onChange(false);
      return false;
    }
  }

  async disable(): Promise<void> {
    this.wanted = false;
    if (this.sentinel) {
      const s = this.sentinel;
      this.sentinel = null;
      try {
        await s.release();
      } catch {
        // Ignore
      }
    }
    this.onChange(false);
  }

  dispose(): void {
    document.removeEventListener("visibilitychange", this.handleVisibility);
    void this.disable();
  }
}
