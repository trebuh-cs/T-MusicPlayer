/**
 * Browser-native File IO helpers (iPad Safari / Files app / AirDrop compatible).
 * Replaces Tauri dialog/fs APIs with pure HTML file inputs & Blob downloads.
 */

export function pickTextFile(accept = ".tviz,.json,application/json"): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.onchange = async () => {
      settled = true;
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        resolve(null);
        return;
      }
      try {
        const text = await file.text();
        resolve({ name: file.name, text });
      } catch {
        resolve(null);
      }
    };

    input.oncancel = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(null);
      }
    };

    input.click();
  });
}

export function pickImageAsDataUrl(maxDimension = 1600): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    input.onchange = () => {
      settled = true;
      const file = input.files?.[0];
      cleanup();
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const rawUrl = typeof reader.result === "string" ? reader.result : null;
        if (!rawUrl) {
          resolve(null);
          return;
        }
        // Keep SVGs lossless; resize huge camera/iPad photos so localStorage & .tviz stay lean
        if (file.type === "image/svg+xml" || rawUrl.length < 450_000) {
          resolve(rawUrl);
          return;
        }
        const img = new Image();
        img.onload = () => {
          const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const canvas = document.createElement("canvas");
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(rawUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, w, h);
          try {
            resolve(canvas.toDataURL("image/webp", 0.86));
          } catch {
            resolve(canvas.toDataURL("image/jpeg", 0.86));
          }
        };
        img.onerror = () => resolve(rawUrl);
        img.src = rawUrl;
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    };

    input.oncancel = () => {
      if (!settled) {
        settled = true;
        cleanup();
        resolve(null);
      }
    };

    input.click();
  });
}

export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  window.setTimeout(() => {
    if (a.parentNode) a.parentNode.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1500);
}
