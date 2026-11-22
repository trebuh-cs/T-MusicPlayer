import { useEffect, useState } from "react";
import { Heart, Loader2, Play, Radio, Search, WifiOff } from "lucide-react";
import {
  getRadioByTag,
  getTopRadioStations,
  searchRadioStations,
} from "../services/api";
import type { RadioStation } from "../types";

interface RadioViewProps {
  favorites: RadioStation[];
  activeStationUuid: string | null;
  isPlaying: boolean;
  onPlayStation: (station: RadioStation) => void;
  onToggleFavorite: (station: RadioStation) => void;
}

const GENRE_CHIPS = [
  "Top Stations",
  "Lofi",
  "Synthwave",
  "Chillout",
  "Jazz",
  "Electronic",
  "Rock",
  "Classical",
];

export function RadioView({
  favorites,
  activeStationUuid,
  isPlaying,
  onPlayStation,
  onToggleFavorite,
}: RadioViewProps) {
  const [tab, setTab] = useState<"discover" | "favorites">("discover");
  const [selectedGenre, setSelectedGenre] = useState("Top Stations");
  const [query, setQuery] = useState("");
  const [stations, setStations] = useState<RadioStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const favSet = new Set(favorites.map((s) => s.station_uuid));

  const loadByGenre = async (genre: string) => {
    setSelectedGenre(genre);
    setLoading(true);
    setError(null);
    try {
      const list =
        genre === "Top Stations"
          ? await getTopRadioStations(30)
          : await getRadioByTag(genre, 30);
      setStations(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load stations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadByGenre("Top Stations");
  }, []);

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      await loadByGenre(selectedGenre);
      return;
    }
    setTab("discover");
    setLoading(true);
    setError(null);
    try {
      const list = await searchRadioStations(trimmed, 30);
      setStations(list);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Radio search failed");
    } finally {
      setLoading(false);
    }
  };

  const displayed = tab === "favorites" ? favorites : stations;

  return (
    <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 pb-4 border-b border-[var(--border-subtle)]">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
            Internet Radio
          </h1>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            Free, legal live broadcasts powered by the open Radio Browser directory
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab("discover")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
              tab === "discover"
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            Discover
          </button>
          <button
            type="button"
            onClick={() => setTab("favorites")}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer ${
              tab === "favorites"
                ? "bg-[var(--accent)] text-white"
                : "bg-[var(--bg-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            Saved ({favorites.length})
          </button>
        </div>
      </div>

      {tab === "discover" && (
        <div className="space-y-3">
          <form onSubmit={handleSearch} className="flex gap-2 max-w-lg">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search stations by name (e.g., SomaFM, Nightride, BBC)..."
                className="w-full pl-9 pr-3 py-2 rounded-lg text-xs bg-[var(--bg-surface)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 rounded-lg text-xs font-semibold text-white cursor-pointer"
              style={{ background: "var(--accent)" }}
            >
              Search
            </button>
          </form>

          <div className="flex flex-wrap gap-1.5">
            {GENRE_CHIPS.map((genre) => (
              <button
                key={genre}
                type="button"
                onClick={() => {
                  setQuery("");
                  void loadByGenre(genre);
                }}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
                  selectedGenre === genre && !query.trim()
                    ? "bg-[var(--accent-soft)] text-[var(--accent)] border border-[var(--accent)]"
                    : "bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                {genre}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "discover" && loading ? (
        <div className="py-16 flex items-center justify-center gap-2 text-xs text-[var(--text-secondary)]">
          <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
          Tuning directory...
        </div>
      ) : tab === "discover" && error ? (
        <div className="my-8 p-6 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-elevated)] text-center max-w-md mx-auto space-y-2">
          <WifiOff className="w-7 h-7 mx-auto text-amber-400" />
          <div className="text-sm font-semibold text-[var(--text-primary)]">
            Unable to reach Radio Browser
          </div>
          <p className="text-xs text-[var(--text-secondary)]">{error}</p>
          <button
            type="button"
            onClick={() => void loadByGenre(selectedGenre)}
            className="mt-2 px-4 py-1.5 rounded-lg text-xs font-semibold text-white cursor-pointer"
            style={{ background: "var(--accent)" }}
          >
            Retry
          </button>
        </div>
      ) : displayed.length === 0 ? (
        <div className="py-12 text-center text-xs text-[var(--text-muted)]">
          {tab === "favorites"
            ? "No saved radio stations yet. Heart any station in Discover to pin it here."
            : "No stations matched your query."}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {displayed.map((station) => {
            const isActive = activeStationUuid === station.station_uuid;
            const isFav = favSet.has(station.station_uuid);

            return (
              <div
                key={station.station_uuid}
                className={`group flex items-center gap-3 p-3.5 rounded-xl border transition-colors ${
                  isActive
                    ? "bg-[var(--accent-soft)] border-[var(--accent)]"
                    : "bg-[var(--bg-elevated)] border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
                }`}
              >
                <button
                  type="button"
                  onClick={() => onPlayStation(station)}
                  className="relative w-12 h-12 rounded-xl overflow-hidden shrink-0 bg-[var(--bg-surface)] border border-[var(--border-subtle)] flex items-center justify-center cursor-pointer"
                  aria-label={`Play ${station.name}`}
                >
                  {station.favicon ? (
                    <img
                      src={station.favicon}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                    />
                  ) : (
                    <Radio className="w-5 h-5 text-[var(--accent)]" />
                  )}
                  <span
                    className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity ${
                      isActive && isPlaying
                        ? "opacity-100"
                        : "opacity-0 group-hover:opacity-100"
                    }`}
                  >
                    <Play className="w-4 h-4 text-white fill-current" />
                  </span>
                </button>

                <div
                  className="min-w-0 flex-1 cursor-pointer"
                  onClick={() => onPlayStation(station)}
                >
                  <div className="text-sm font-semibold text-[var(--text-primary)] truncate">
                    {station.name}
                  </div>
                  <div className="text-[11px] text-[var(--text-secondary)] truncate mt-0.5">
                    {station.tags || "Live Broadcast"}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] font-mono-num text-[var(--text-muted)]">
                    {station.country && <span>{station.country}</span>}
                    {station.bitrate && <span>{station.bitrate} kbps</span>}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onToggleFavorite(station)}
                  title={isFav ? "Remove saved station" : "Save station"}
                  className={`p-1.5 rounded-lg cursor-pointer shrink-0 ${
                    isFav
                      ? "text-rose-400"
                      : "text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                  }`}
                >
                  <Heart className={`w-4 h-4 ${isFav ? "fill-current" : ""}`} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
