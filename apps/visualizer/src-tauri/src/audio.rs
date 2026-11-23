//! System-wide Windows WASAPI loopback audio capture and real-time 512-point FFT spectrum engine.

use std::f32::consts::PI;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use rustfft::num_complex::Complex;
use rustfft::FftPlanner;
use serde::Serialize;

pub const FFT_SIZE: usize = 512;
pub const FFT_BINS: usize = FFT_SIZE / 2;

#[derive(Debug, Clone, Serialize)]
pub struct AudioDeviceInfo {
    pub id: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct AudioStatus {
    pub active: bool,
    pub capturing: bool,
    pub device_name: String,
    pub selected_device_id: Option<String>,
    pub error: Option<String>,
}

pub struct AudioEngine {
    bins: Arc<Mutex<[u8; FFT_BINS]>>,
    status: Arc<Mutex<AudioStatus>>,
    selected_device_id: Arc<Mutex<Option<String>>>,
    generation: Arc<AtomicU64>,
    running: Arc<AtomicBool>,
}

impl AudioEngine {
    pub fn start() -> Self {
        let bins = Arc::new(Mutex::new([0u8; FFT_BINS]));
        let status = Arc::new(Mutex::new(AudioStatus {
            active: false,
            capturing: false,
            device_name: "System Default".to_string(),
            selected_device_id: None,
            error: None,
        }));
        let selected_device_id = Arc::new(Mutex::new(None));
        let generation = Arc::new(AtomicU64::new(0));
        let running = Arc::new(AtomicBool::new(true));

        #[cfg(windows)]
        {
            let b = Arc::clone(&bins);
            let s = Arc::clone(&status);
            let sel = Arc::clone(&selected_device_id);
            let gen = Arc::clone(&generation);
            let run = Arc::clone(&running);
            thread::Builder::new()
                .name("wasapi-loopback".to_string())
                .spawn(move || win_capture::run_loopback_thread(b, s, sel, gen, run))
                .expect("failed to spawn WASAPI loopback thread");
        }

        Self {
            bins,
            status,
            selected_device_id,
            generation,
            running,
        }
    }

    pub fn snapshot_bins(&self) -> Vec<u8> {
        self.bins
            .lock()
            .map(|b| b.to_vec())
            .unwrap_or_else(|_| vec![0u8; FFT_BINS])
    }

    pub fn get_status(&self) -> AudioStatus {
        self.status
            .lock()
            .map(|s| s.clone())
            .unwrap_or(AudioStatus {
                active: false,
                capturing: false,
                device_name: "Unknown".to_string(),
                selected_device_id: None,
                error: Some("Audio status lock poisoned".to_string()),
            })
    }

    pub fn select_device(&self, device_id: Option<String>) {
        let clean = device_id.and_then(|s| {
            let t = s.trim().to_string();
            if t.is_empty() || t == "default" {
                None
            } else {
                Some(t)
            }
        });
        if let Ok(mut guard) = self.selected_device_id.lock() {
            *guard = clean.clone();
        }
        if let Ok(mut st) = self.status.lock() {
            st.selected_device_id = clean;
        }
        self.generation.fetch_add(1, Ordering::SeqCst);
    }

    pub fn list_devices(&self) -> Vec<AudioDeviceInfo> {
        #[cfg(windows)]
        {
            win_capture::list_render_devices().unwrap_or_default()
        }
        #[cfg(not(windows))]
        {
            Vec::new()
        }
    }

    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
    }
}

impl Drop for AudioEngine {
    fn drop(&mut self) {
        self.stop();
    }
}

/// Computes 256 WebAudio-compatible byte frequency bins (0..=255) from 512 mono PCM samples.
/// Returns `true` if the signal contains audible energy.
pub fn compute_fft_bins(
    samples: &[f32; FFT_SIZE],
    planner: &mut FftPlanner<f32>,
    out: &mut [u8; FFT_BINS],
) -> bool {
    let mut peak = 0.0f32;
    let mut buffer = [Complex::new(0.0f32, 0.0f32); FFT_SIZE];
    for (i, &s) in samples.iter().enumerate() {
        let abs = s.abs();
        if abs > peak {
            peak = abs;
        }
        let hann = 0.5 * (1.0 - (2.0 * PI * i as f32 / (FFT_SIZE as f32 - 1.0)).cos());
        buffer[i] = Complex::new(s * hann, 0.0);
    }

    if peak < 0.00025 {
        out.fill(0);
        return false;
    }

    let fft = planner.plan_fft_forward(FFT_SIZE);
    fft.process(&mut buffer);

    // Match WebAudio AnalyserNode dB scaling (-82 dB floor to -14 dB ceiling).
    const MIN_DB: f32 = -82.0;
    const MAX_DB: f32 = -14.0;
    const DB_SPAN: f32 = MAX_DB - MIN_DB;

    for i in 0..FFT_BINS {
        let mag = buffer[i].norm() / (FFT_SIZE as f32 * 0.5);
        let db = 20.0 * (mag + 1e-9).log10();
        let norm = ((db - MIN_DB) / DB_SPAN).clamp(0.0, 1.0);
        out[i] = (norm * 255.0).round() as u8;
    }

    true
}

#[cfg(windows)]
mod win_capture {
    use super::*;
    use std::time::{Duration, Instant};

    use windows::core::{GUID, HSTRING, PWSTR};
    use windows::Win32::Devices::FunctionDiscovery::PKEY_Device_FriendlyName;
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDevice, IMMDeviceEnumerator,
        MMDeviceEnumerator, AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED,
        AUDCLNT_STREAMFLAGS_LOOPBACK, DEVICE_STATE_ACTIVE, WAVEFORMATEX, WAVEFORMATEXTENSIBLE,
    };
    use windows::Win32::Media::Multimedia::WAVE_FORMAT_IEEE_FLOAT;
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED, STGM_READ,
    };

    const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;
    // Standard Windows KSDATAFORMAT_SUBTYPE_IEEE_FLOAT ({00000003-0000-0010-8000-00aa00389b71})
    const KSDATAFORMAT_SUBTYPE_IEEE_FLOAT: GUID =
        GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

    fn pwstr_to_string(ptr: PWSTR) -> String {
        if ptr.is_null() {
            return String::new();
        }
        unsafe {
            let s = ptr.to_string().unwrap_or_default();
            CoTaskMemFree(Some(ptr.0 as *const _));
            s
        }
    }

    fn device_friendly_name(device: &IMMDevice) -> String {
        unsafe {
            let Ok(store) = device.OpenPropertyStore(STGM_READ) else {
                return "Audio Output".to_string();
            };
            let Ok(prop) = store.GetValue(&PKEY_Device_FriendlyName) else {
                return "Audio Output".to_string();
            };
            match PropVariantToStringAlloc(&prop) {
                Ok(pwstr) => {
                    let s = pwstr_to_string(pwstr);
                    if s.is_empty() {
                        "Audio Output".to_string()
                    } else {
                        s
                    }
                }
                Err(_) => "Audio Output".to_string(),
            }
        }
    }

    fn device_id_string(device: &IMMDevice) -> String {
        unsafe {
            match device.GetId() {
                Ok(pwstr) => pwstr_to_string(pwstr),
                Err(_) => String::new(),
            }
        }
    }

    pub fn list_render_devices() -> Result<Vec<AudioDeviceInfo>, String> {
        unsafe {
            let com_ok = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
            let result = (|| -> Result<Vec<AudioDeviceInfo>, String> {
                let enumerator: IMMDeviceEnumerator =
                    CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                        .map_err(|e| format!("Failed creating MMDeviceEnumerator: {e}"))?;
                let default_id = enumerator
                    .GetDefaultAudioEndpoint(eRender, eConsole)
                    .ok()
                    .map(|d| device_id_string(&d))
                    .unwrap_or_default();

                let collection = enumerator
                    .EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE)
                    .map_err(|e| format!("Failed listing audio devices: {e}"))?;
                let count = collection.GetCount().unwrap_or(0);
                let mut out = Vec::with_capacity(count as usize);
                for idx in 0..count {
                    if let Ok(dev) = collection.Item(idx) {
                        let id = device_id_string(&dev);
                        let name = device_friendly_name(&dev);
                        out.push(AudioDeviceInfo {
                            is_default: !default_id.is_empty() && id == default_id,
                            id,
                            name,
                        });
                    }
                }
                Ok(out)
            })();
            if com_ok {
                CoUninitialize();
            }
            result
        }
    }

    pub fn run_loopback_thread(
        bins: Arc<Mutex<[u8; FFT_BINS]>>,
        status: Arc<Mutex<AudioStatus>>,
        selected_device_id: Arc<Mutex<Option<String>>>,
        generation: Arc<AtomicU64>,
        running: Arc<AtomicBool>,
    ) {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }

        let mut planner = FftPlanner::<f32>::new();

        while running.load(Ordering::Relaxed) {
            let gen_start = generation.load(Ordering::SeqCst);
            let target_id = selected_device_id.lock().ok().and_then(|g| g.clone());

            match capture_session(
                &bins,
                &status,
                target_id.as_deref(),
                gen_start,
                &generation,
                &running,
                &mut planner,
            ) {
                Ok(()) => {}
                Err(err) => {
                    if let Ok(mut b) = bins.lock() {
                        b.fill(0);
                    }
                    if let Ok(mut st) = status.lock() {
                        st.active = false;
                        st.capturing = false;
                        st.error = Some(err);
                    }
                    thread::sleep(Duration::from_millis(600));
                }
            }
        }

        unsafe {
            CoUninitialize();
        }
    }

    fn capture_session(
        bins: &Arc<Mutex<[u8; FFT_BINS]>>,
        status: &Arc<Mutex<AudioStatus>>,
        target_id: Option<&str>,
        gen_start: u64,
        generation: &Arc<AtomicU64>,
        running: &Arc<AtomicBool>,
        planner: &mut FftPlanner<f32>,
    ) -> Result<(), String> {
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("Audio enumerator error: {e}"))?;

            let device: IMMDevice = if let Some(id) = target_id {
                enumerator
                    .GetDevice(&HSTRING::from(id))
                    .or_else(|_| enumerator.GetDefaultAudioEndpoint(eRender, eConsole))
                    .map_err(|e| format!("Audio device unavailable: {e}"))?
            } else {
                enumerator
                    .GetDefaultAudioEndpoint(eRender, eConsole)
                    .map_err(|e| format!("No default audio output device found: {e}"))?
            };

            let active_dev_id = device_id_string(&device);
            let friendly_name = device_friendly_name(&device);

            let audio_client: IAudioClient = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Failed activating audio client: {e}"))?;

            let mix_fmt_ptr: *mut WAVEFORMATEX = audio_client
                .GetMixFormat()
                .map_err(|e| format!("Failed reading mix format: {e}"))?;

            let mix_fmt = *mix_fmt_ptr;
            let channels = mix_fmt.nChannels.max(1) as usize;
            let bits = mix_fmt.wBitsPerSample;
            let is_float = if mix_fmt.wFormatTag as u32 == WAVE_FORMAT_IEEE_FLOAT {
                true
            } else if mix_fmt.wFormatTag == WAVE_FORMAT_EXTENSIBLE {
                let ext = *(mix_fmt_ptr as *const WAVEFORMATEXTENSIBLE);
                let sub = ext.SubFormat;
                sub == KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
            } else {
                false
            };

            // 20 ms shared-mode loopback buffer (200_000 * 100ns units).
            let init_res = audio_client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                200_000,
                0,
                mix_fmt_ptr,
                None,
            );
            CoTaskMemFree(Some(mix_fmt_ptr as *const _));
            init_res.map_err(|e| format!("Failed initializing WASAPI loopback: {e}"))?;

            let capture_client: IAudioCaptureClient = audio_client
                .GetService()
                .map_err(|e| format!("Failed acquiring capture client: {e}"))?;

            audio_client
                .Start()
                .map_err(|e| format!("Failed starting audio capture: {e}"))?;

            if let Ok(mut st) = status.lock() {
                st.capturing = true;
                st.device_name = friendly_name;
                st.error = None;
            }

            let mut ring = [0.0f32; FFT_SIZE];
            let mut ring_pos = 0usize;
            let mut ordered = [0.0f32; FFT_SIZE];
            let mut fft_out = [0u8; FFT_BINS];
            let mut last_packet_at = Instant::now();
            let mut last_default_check = Instant::now();

            while running.load(Ordering::Relaxed)
                && generation.load(Ordering::SeqCst) == gen_start
            {
                // Auto-follow default Windows audio device switches (e.g. speakers <-> headset).
                if target_id.is_none() && last_default_check.elapsed() >= Duration::from_secs(1) {
                    last_default_check = Instant::now();
                    if let Ok(def_dev) = enumerator.GetDefaultAudioEndpoint(eRender, eConsole) {
                        if device_id_string(&def_dev) != active_dev_id {
                            break;
                        }
                    }
                }

                let mut packet_len = match capture_client.GetNextPacketSize() {
                    Ok(n) => n,
                    Err(_) => break,
                };
                let mut got_any_frames = false;

                while packet_len > 0 {
                    let mut data_ptr: *mut u8 = std::ptr::null_mut();
                    let mut num_frames: u32 = 0;
                    let mut flags: u32 = 0;

                    if capture_client
                        .GetBuffer(&mut data_ptr, &mut num_frames, &mut flags, None, None)
                        .is_err()
                    {
                        let _ = audio_client.Stop();
                        return Ok(());
                    }

                    let frame_count = num_frames as usize;
                    if frame_count > 0 {
                        got_any_frames = true;
                        let is_silent = (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;

                        if is_silent || data_ptr.is_null() {
                            for _ in 0..frame_count {
                                ring[ring_pos] = 0.0;
                                ring_pos = (ring_pos + 1) % FFT_SIZE;
                            }
                        } else if is_float && bits == 32 {
                            let samples = std::slice::from_raw_parts(
                                data_ptr as *const f32,
                                frame_count * channels,
                            );
                            for frame in samples.chunks_exact(channels) {
                                let sum: f32 = frame.iter().copied().sum();
                                ring[ring_pos] = sum / channels as f32;
                                ring_pos = (ring_pos + 1) % FFT_SIZE;
                            }
                        } else if bits == 16 {
                            let samples = std::slice::from_raw_parts(
                                data_ptr as *const i16,
                                frame_count * channels,
                            );
                            for frame in samples.chunks_exact(channels) {
                                let sum: f32 = frame.iter().map(|&v| v as f32 / 32768.0).sum();
                                ring[ring_pos] = sum / channels as f32;
                                ring_pos = (ring_pos + 1) % FFT_SIZE;
                            }
                        }
                    }

                    let _ = capture_client.ReleaseBuffer(num_frames);
                    packet_len = capture_client.GetNextPacketSize().unwrap_or(0);
                }

                if got_any_frames {
                    last_packet_at = Instant::now();
                } else if last_packet_at.elapsed() >= Duration::from_millis(45) {
                    // WASAPI loopback stops delivering packets during complete silence;
                    // decay ring buffer cleanly so bars settle down to rest.
                    for sample in &mut ring {
                        *sample *= 0.65;
                    }
                }

                // Linearize circular ring buffer oldest -> newest and compute FFT.
                let tail = FFT_SIZE - ring_pos;
                ordered[..tail].copy_from_slice(&ring[ring_pos..]);
                ordered[tail..].copy_from_slice(&ring[..ring_pos]);

                let active = compute_fft_bins(&ordered, planner, &mut fft_out);
                if let Ok(mut b) = bins.lock() {
                    *b = fft_out;
                }
                if let Ok(mut st) = status.lock() {
                    st.active = active;
                }

                thread::sleep(Duration::from_millis(8));
            }

            let _ = audio_client.Stop();
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fft_detects_sine_wave_and_zeros_silence() {
        let mut planner = FftPlanner::<f32>::new();
        let mut out = [0u8; FFT_BINS];

        let silence = [0.0f32; FFT_SIZE];
        assert!(!compute_fft_bins(&silence, &mut planner, &mut out));
        assert!(out.iter().all(|&b| b == 0));

        // 48 kHz sample rate, bin ~10 (~937 Hz)
        let mut sine = [0.0f32; FFT_SIZE];
        for (i, sample) in sine.iter_mut().enumerate() {
            *sample = 0.5 * (2.0 * PI * 10.0 * i as f32 / FFT_SIZE as f32).sin();
        }
        assert!(compute_fft_bins(&sine, &mut planner, &mut out));
        assert!(out[10] > 160, "expected strong peak at bin 10, got {}", out[10]);
        assert!(out[10] > out[40]);
    }
}
