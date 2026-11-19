import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, Link2, RefreshCw } from 'lucide-react';
import type { Channel, PlaylistResponse } from './types/channel';
import { VideoPlayer } from './components/VideoPlayer';
import {
  ChannelDirectory,
  type FormatFilter,
  type ViewMode,
} from './components/ChannelDirectory';

const DEFAULT_PLAYLIST_URL =
  'https://raw.githubusercontent.com/windozalmi/Playlist_IPTV_Pribadi/refs/heads/m3u-ipvt/IPTV%20Indonesia%20by%20WINDO%20ZALMI';

const FAVORITES_STORAGE_KEY = 'nusantara_stream_favorites_v1';

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((x): x is string => typeof x === 'string'));
    }
  } catch {
    // Ignore storage read errors
  }
  return new Set();
}

export default function App() {
  const [playlistUrl, setPlaylistUrl] = useState<string>(DEFAULT_PLAYLIST_URL);
  const [customUrlInput, setCustomUrlInput] = useState<string>(DEFAULT_PLAYLIST_URL);
  const [showUrlEditor, setShowUrlEditor] = useState<boolean>(false);

  const [playlist, setPlaylist] = useState<PlaylistResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string>('');

  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [formatFilter, setFormatFilter] = useState<FormatFilter>('all');
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const [activeChannel, setActiveChannel] = useState<Channel | null>(null);
  const [favorites, setFavorites] = useState<Set<string>>(() => loadFavorites());

  const fetchPlaylist = useCallback(async (targetUrl: string, forceRefresh = false) => {
    setIsLoading(true);
    setLoadError('');
    try {
      const params = new URLSearchParams({ url: targetUrl });
      if (forceRefresh) params.set('refresh', '1');
      const res = await fetch(`/api/playlist?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Gagal memuat daftar saluran M3U');
      }
      const parsed = data as PlaylistResponse;
      setPlaylist(parsed);
      setActiveChannel((prev) => {
        if (prev) {
          const matching = parsed.channels.find((c) => c.url === prev.url);
          if (matching) return matching;
        }
        return parsed.channels[0] || null;
      });
    } catch (err) {
      setLoadError(
        err instanceof Error ? err.message : 'Terjadi kesalahan saat memuat playlist'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlaylist(playlistUrl);
  }, [playlistUrl, fetchPlaylist]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch {
        // Ignore storage write errors
      }
      return next;
    });
  }, []);

  const channels = playlist?.channels ?? [];
  const categories = playlist?.categories ?? [];

  const filteredChannels = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return channels.filter((ch) => {
      if (selectedCategory === 'FAVORITES') {
        if (!favorites.has(ch.id)) return false;
      } else if (selectedCategory !== 'ALL') {
        if (ch.group !== selectedCategory) return false;
      }

      if (formatFilter !== 'all' && ch.format !== formatFilter) {
        return false;
      }

      if (q) {
        const hay = `${ch.name} ${ch.group} ${ch.tvgId}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }

      return true;
    });
  }, [channels, selectedCategory, formatFilter, searchQuery, favorites]);

  const activeIndex = useMemo(() => {
    if (!activeChannel) return -1;
    return filteredChannels.findIndex((c) => c.id === activeChannel.id);
  }, [filteredChannels, activeChannel]);

  const handlePrevChannel = () => {
    if (activeIndex > 0) {
      setActiveChannel(filteredChannels[activeIndex - 1]);
    } else if (filteredChannels.length > 0 && activeIndex === -1) {
      setActiveChannel(filteredChannels[0]);
    }
  };

  const handleNextChannel = () => {
    if (activeIndex >= 0 && activeIndex < filteredChannels.length - 1) {
      setActiveChannel(filteredChannels[activeIndex + 1]);
    } else if (filteredChannels.length > 0 && activeIndex === -1) {
      setActiveChannel(filteredChannels[0]);
    }
  };

  const handleExportFilteredM3u = () => {
    if (filteredChannels.length === 0) return;
    const lines = ['#EXTM3U'];
    for (const ch of filteredChannels) {
      const attrs: string[] = [];
      if (ch.tvgId) attrs.push(`tvg-id="${ch.tvgId}"`);
      if (ch.logo) attrs.push(`tvg-logo="${ch.logo}"`);
      if (ch.group) attrs.push(`group-title="${ch.group}"`);
      lines.push(`#EXTINF:-1 ${attrs.join(' ')},${ch.name}`);
      if (ch.headers.userAgent) lines.push(`#EXTVLCOPT:http-user-agent=${ch.headers.userAgent}`);
      if (ch.headers.referrer) lines.push(`#EXTVLCOPT:http-referrer=${ch.headers.referrer}`);
      if (ch.headers.origin) lines.push(`#EXTVLCOPT:http-origin=${ch.headers.origin}`);
      lines.push(ch.url);
    }
    const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'playlist_live_streaming.m3u';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleApplyCustomUrl = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = customUrlInput.trim();
    if (!trimmed) return;
    setPlaylistUrl(trimmed);
    setSelectedCategory('ALL');
    setShowUrlEditor(false);
  };

  // Match quick top-bar category shortcuts to real playlist groups
  const quickLinks = useMemo(() => {
    const findGroup = (keyword: string) =>
      categories.find((c) => c.name.toLowerCase().includes(keyword))?.name;

    return [
      { label: 'Semua', target: 'ALL' },
      { label: 'Indonesia', target: findGroup('indonesia channels') || 'Indonesia Channels' },
      { label: 'Berita', target: findGroup('news') || 'News Channel' },
      { label: 'Olahraga', target: findGroup('sport') || 'SPORTS' },
      { label: 'Favorit', target: 'FAVORITES' },
    ];
  }, [categories]);

  return (
    <div className="min-h-screen bg-[#0B0E14] text-[#F1F5F9] flex flex-col">
      {/* Top Bar Contract: Brand Wordmark — 5 Concise Links — 1 Primary Action */}
      <header className="border-b border-slate-800/80 bg-[#0B0E14]/95 sticky top-0 z-30 backdrop-blur-sm">
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-8">
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setSelectedCategory('ALL');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Nusantara Stream
          </a>

          <nav
            aria-label="Navigasi Cepat Kategori"
            className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-400"
          >
            {quickLinks.map((item) => {
              const active = selectedCategory === item.target;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setSelectedCategory(item.target)}
                  className={`transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active
                      ? 'text-white underline underline-offset-8 decoration-red-500 decoration-2'
                      : 'hover:text-slate-100'
                  }`}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex items-center shrink-0">
            <button
              type="button"
              onClick={() => fetchPlaylist(playlistUrl, true)}
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-60 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              <span>Muat Ulang</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Workspace */}
      <main id="top" className="flex-1 max-w-[1440px] w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Source Summary & M3U Actions Bar */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-800/80">
          <div className="min-w-0">
            <h1 className="font-display text-xl sm:text-2xl font-bold text-white tracking-tight text-balance">
              Daftar Live Streaming TV Indonesia & Internasional
            </h1>
            <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs text-slate-400 mt-1">
              <span>Sumber: IPTV Indonesia by WINDO ZALMI</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-300">
                {playlist ? `${playlist.totalChannels} saluran` : 'Memuat saluran...'}
              </span>
              {playlist?.fetchedAt && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums">
                    Diperbarui {new Date(playlist.fetchedAt).toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </>
              )}
            </div>
          </div>

          <div className="flex items-center flex-wrap gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setShowUrlEditor((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#111621] border border-slate-800 hover:border-slate-700 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Link2 className="w-3.5 h-3.5" />
              <span>Sumber M3U</span>
            </button>

            <button
              type="button"
              onClick={handleExportFilteredM3u}
              disabled={filteredChannels.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#111621] border border-slate-800 hover:border-slate-700 disabled:opacity-40 text-xs font-medium text-slate-300 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Ekspor .m3u</span>
            </button>
          </div>
        </div>

        {/* Optional Playlist URL Switcher */}
        {showUrlEditor && (
          <form
            onSubmit={handleApplyCustomUrl}
            className="bg-[#111621] border border-slate-800 rounded-xl p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
          >
            <input
              type="url"
              value={customUrlInput}
              onChange={(e) => setCustomUrlInput(e.target.value)}
              placeholder="Tempel URL playlist .m3u / .m3u8..."
              aria-label="URL playlist M3U"
              className="flex-1 bg-[#0B0E14] border border-slate-800 rounded-lg px-3 py-2 text-xs font-mono text-slate-200 focus:outline-none focus:border-slate-600"
            />
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Muat Playlist
              </button>
              <button
                type="button"
                onClick={() => {
                  setCustomUrlInput(DEFAULT_PLAYLIST_URL);
                  setPlaylistUrl(DEFAULT_PLAYLIST_URL);
                  setShowUrlEditor(false);
                }}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Default
              </button>
            </div>
          </form>
        )}

        {/* Playlist Fetch Error Banner */}
        {loadError && (
          <div className="bg-red-950/30 border border-red-900/60 rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-red-200">
                  Gagal memuat playlist M3U
                </p>
                <p className="text-xs text-red-300/80 mt-0.5">{loadError}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => fetchPlaylist(playlistUrl, true)}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Coba Lagi
            </button>
          </div>
        )}

        {/* Live Video Player Stage */}
        <VideoPlayer
          channel={activeChannel}
          isFavorite={activeChannel ? favorites.has(activeChannel.id) : false}
          onToggleFavorite={toggleFavorite}
          onPrevChannel={handlePrevChannel}
          onNextChannel={handleNextChannel}
          hasPrev={activeIndex > 0}
          hasNext={activeIndex >= 0 && activeIndex < filteredChannels.length - 1}
        />

        {/* Channel Directory */}
        <ChannelDirectory
          channels={channels}
          filteredChannels={filteredChannels}
          categories={categories}
          selectedCategory={selectedCategory}
          onSelectCategory={setSelectedCategory}
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          formatFilter={formatFilter}
          onFormatFilterChange={setFormatFilter}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          activeChannelId={activeChannel?.id ?? null}
          onSelectChannel={(ch) => {
            setActiveChannel(ch);
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          favorites={favorites}
          onToggleFavorite={toggleFavorite}
          isLoading={isLoading}
        />
      </main>
    </div>
  );
}
