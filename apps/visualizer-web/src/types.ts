export * from "@shared/visualizer/types";

export interface WebAudioDeviceInfo {
  id: string;
  name: string;
  isDefault: boolean;
}

export interface WebAudioStatus {
  active: boolean;
  capturing: boolean;
  demoMode: boolean;
  deviceName: string;
  selectedDeviceId: string | null;
  inputGain: number;
  noiseGate: number;
  peakLevel: number;
  error: string | null;
}

export interface SpotifyConnectionState {
  clientId: string;
  connected: boolean;
  connecting: boolean;
  userName: string | null;
  error: string | null;
  lastUpdatedAt: number | null;
}
