export * from "@shared/visualizer/types";

export interface AudioDeviceInfo {
  id: string;
  name: string;
  is_default: boolean;
}

export interface AudioStatus {
  active: boolean;
  capturing: boolean;
  device_name: string;
  selected_device_id: string | null;
  error: string | null;
}

export interface MonitorInfo {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  is_primary: boolean;
}
