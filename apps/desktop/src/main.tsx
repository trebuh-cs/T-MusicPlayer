import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { DesktopWallpaperSurface } from "./components/DesktopWallpaperSurface";
import "./index.css";

const isWallpaperSurface =
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).get("wallpaper") === "1";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isWallpaperSurface ? <DesktopWallpaperSurface /> : <App />}
  </StrictMode>
);
