import { Heart, LayoutGrid, List, Play, Search, X } from 'lucide-react';
import type { CategorySummary, Channel, StreamFormat } from '../types/channel';
import { ChannelLogo } from './ChannelLogo';

export type FormatFilter = 'all' | StreamFormat;
export type ViewMode = 'list' | 'grid';

interface ChannelDirectoryProps {
  channels: Channel[];
  filteredChannels: Channel[];
  categories: CategorySummary[];
  selectedCategory: string;
  onSelectCategory: (category: string) => void;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  formatFilter: FormatFilter;
  onFormatFilterChange: (fmt: FormatFilter) => void;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  activeChannelId: string | null;
  onSelectChannel: (channel: Channel) => void;
  favorites: Set<string>;
  onToggleFavorite: (id: string) => void;
  isLoading: boolean;
}

export function ChannelDirectory({
  channels,
  filteredChannels,
  categories,
  selectedCategory,
  onSelectCategory,
  searchQuery,
  onSearchChange,
  formatFilter,
  onFormatFilterChange,
  viewMode,
  onViewModeChange,
  activeChannelId,
  onSelectChannel,
  favorites,
  onToggleFavorite,
  isLoading,
}: ChannelDirectoryProps) {
  const hasActiveFilters =
    selectedCategory !== 'ALL' || formatFilter !== 'all' || searchQuery.trim().length > 0;

  const resetFilters = () => {
    onSelectCategory('ALL');
    onFormatFilterChange('all');
    onSearchChange('');
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[260px_minmax(0,1fr)] gap-6 items-start">
      {/* Category Sidebar */}
      <aside
        aria-label="Kategori Saluran"
        className="bg-[#111621] border border-slate-800/90 rounded-xl p-4"
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-800/80">
          <h2 className="font-display text-sm font-semibold text-slate-100">
            Kategori Saluran
          </h2>
          <span className="font-mono text-xs text-slate-400 tabular-nums">
            {categories.length} grup
          </span>
        </div>

        <nav className="mt-3 flex lg:flex-col gap-1 overflow-x-auto lg:overflow-x-visible pb-1 lg:pb-0">
          <button
            type="button"
            onClick={() => onSelectCategory('ALL')}
            className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap shrink-0 lg:w-full cursor-pointer ${
              selectedCategory === 'ALL'
                ? 'bg-red-600 text-white font-medium'
                : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
            }`}
          >
            <span className="truncate">Semua Saluran</span>
            <span
              className={`font-mono text-xs tabular-nums ${
                selectedCategory === 'ALL' ? 'text-red-100' : 'text-slate-500'
              }`}
            >
              {channels.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => onSelectCategory('FAVORITES')}
            className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap shrink-0 lg:w-full cursor-pointer ${
              selectedCategory === 'FAVORITES'
                ? 'bg-red-600 text-white font-medium'
                : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
            }`}
          >
            <span className="truncate">Saluran Favorit</span>
            <span
              className={`font-mono text-xs tabular-nums ${
                selectedCategory === 'FAVORITES' ? 'text-red-100' : 'text-slate-500'
              }`}
            >
              {favorites.size}
            </span>
          </button>

          <div className="hidden lg:block my-2 border-t border-slate-800/70" />

          {categories.map((cat) => {
            const active = selectedCategory === cat.name;
            return (
              <button
                key={cat.name}
                type="button"
                onClick={() => onSelectCategory(cat.name)}
                className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm transition-colors whitespace-nowrap shrink-0 lg:w-full cursor-pointer ${
                  active
                    ? 'bg-red-600 text-white font-medium'
                    : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
                }`}
              >
                <span className="truncate text-left">{cat.name}</span>
                <span
                  className={`font-mono text-xs tabular-nums ${
                    active ? 'text-red-100' : 'text-slate-500'
                  }`}
                >
                  {cat.count}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Main Channel List / Grid Panel */}
      <div className="bg-[#111621] border border-slate-800/90 rounded-xl overflow-hidden min-w-0">
        {/* Filter & Search Toolbar */}
        <div className="p-4 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Cari nama saluran atau kategori..."
              aria-label="Cari saluran"
              className="w-full bg-[#0B0E14] border border-slate-800 rounded-lg pl-9 pr-8 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-slate-600 transition-colors"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Hapus pencarian"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center flex-wrap gap-2 shrink-0">
            {/* Format Segmented Filter */}
            <div
              role="group"
              aria-label="Filter format stream"
              className="flex items-center gap-1 p-1 bg-[#0B0E14] border border-slate-800 rounded-lg"
            >
              {(
                [
                  { id: 'all', label: 'Semua' },
                  { id: 'hls', label: 'HLS' },
                  { id: 'dash', label: 'DASH' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onFormatFilterChange(tab.id)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    formatFilter === tab.id
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* View Switch */}
            <div
              role="group"
              aria-label="Mode tampilan"
              className="flex items-center gap-1 p-1 bg-[#0B0E14] border border-slate-800 rounded-lg"
            >
              <button
                type="button"
                onClick={() => onViewModeChange('list')}
                aria-label="Tampilan daftar"
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  viewMode === 'list'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <List className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => onViewModeChange('grid')}
                aria-label="Tampilan grid"
                className={`p-1.5 rounded-md transition-colors cursor-pointer ${
                  viewMode === 'grid'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Result Summary Strip */}
        <div className="px-4 py-2.5 bg-[#0E131D] border-b border-slate-800/80 flex items-center justify-between gap-4 text-xs text-slate-400">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate">
              {selectedCategory === 'ALL'
                ? 'Semua Saluran'
                : selectedCategory === 'FAVORITES'
                  ? 'Saluran Favorit'
                  : selectedCategory}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums text-slate-300 shrink-0">
              {filteredChannels.length} saluran
            </span>
          </div>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="text-xs font-medium text-red-400 hover:text-red-300 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              Reset Filter
            </button>
          )}
        </div>

        {/* Loading Skeleton */}
        {isLoading && (
          <div className="divide-y divide-slate-800/70">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className="px-4 py-3 flex items-center gap-3.5 animate-pulse">
                <div className="w-8 h-4 bg-slate-800 rounded" />
                <div className="w-10 h-10 bg-slate-800 rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="w-44 h-4 bg-slate-800 rounded" />
                  <div className="w-28 h-3 bg-slate-800/70 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!isLoading && filteredChannels.length === 0 && (
          <div className="px-6 py-14 text-center">
            <p className="font-display text-base font-semibold text-slate-200">
              Tidak ada saluran yang cocok
            </p>
            <p className="text-sm text-slate-400 mt-1 max-w-md mx-auto">
              {selectedCategory === 'FAVORITES'
                ? 'Anda belum menandai saluran favorit. Klik ikon hati pada saluran untuk menyimpannya.'
                : 'Coba ubah kata kunci pencarian atau pilih kategori lain.'}
            </p>
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="mt-4 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Tampilkan Semua Saluran
              </button>
            )}
          </div>
        )}

        {/* List View */}
        {!isLoading && filteredChannels.length > 0 && viewMode === 'list' && (
          <div className="divide-y divide-slate-800/70 max-h-[620px] overflow-y-auto">
            {filteredChannels.map((ch) => {
              const isActive = ch.id === activeChannelId;
              const isFav = favorites.has(ch.id);

              return (
                <div
                  key={ch.id}
                  onClick={() => onSelectChannel(ch)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectChannel(ch);
                    }
                  }}
                  className={`px-4 py-2.5 flex items-center justify-between gap-4 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500 ${
                    isActive
                      ? 'bg-[#192130]'
                      : 'hover:bg-[#151C29]'
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span
                      className={`font-mono text-xs tabular-nums w-7 shrink-0 ${
                        isActive ? 'text-red-400 font-semibold' : 'text-slate-500'
                      }`}
                    >
                      {String(ch.number).padStart(3, '0')}
                    </span>

                    <ChannelLogo src={ch.logo} name={ch.name} size="md" />

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm font-medium truncate ${
                            isActive ? 'text-white' : 'text-slate-100'
                          }`}
                        >
                          {ch.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 mt-0.5 truncate">
                        <span className="truncate">{ch.group}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono uppercase shrink-0">{ch.format}</span>
                        {ch.drm?.licenseType && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="shrink-0">
                              {ch.drm.licenseType.includes('clearkey') ? 'ClearKey' : 'DRM'}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(ch.id);
                      }}
                      aria-label={isFav ? `Hapus ${ch.name} dari favorit` : `Simpan ${ch.name} ke favorit`}
                      className={`p-2 rounded-lg transition-colors cursor-pointer ${
                        isFav
                          ? 'text-red-400 hover:bg-slate-800'
                          : 'text-slate-500 hover:text-slate-200 hover:bg-slate-800'
                      }`}
                    >
                      <Heart className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                    </button>

                    <span
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        isActive
                          ? 'bg-red-600 text-white'
                          : 'bg-[#0B0E14] border border-slate-800 text-slate-200'
                      }`}
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>{isActive ? 'Aktif' : 'Tonton'}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Grid View */}
        {!isLoading && filteredChannels.length > 0 && viewMode === 'grid' && (
          <div className="p-4 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 max-h-[620px] overflow-y-auto">
            {filteredChannels.map((ch) => {
              const isActive = ch.id === activeChannelId;
              const isFav = favorites.has(ch.id);

              return (
                <div
                  key={ch.id}
                  onClick={() => onSelectChannel(ch)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onSelectChannel(ch);
                    }
                  }}
                  className={`p-3.5 rounded-xl border transition-colors cursor-pointer flex flex-col justify-between gap-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 ${
                    isActive
                      ? 'bg-[#192130] border-red-600/60'
                      : 'bg-[#0E131D] border-slate-800/80 hover:border-slate-700 hover:bg-[#151C29]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <ChannelLogo src={ch.logo} name={ch.name} size="md" />
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {String(ch.number).padStart(3, '0')}
                        </div>
                        <h3 className="font-display text-sm font-semibold text-slate-100 truncate">
                          {ch.name}
                        </h3>
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleFavorite(ch.id);
                      }}
                      aria-label={isFav ? `Hapus ${ch.name} dari favorit` : `Simpan ${ch.name} ke favorit`}
                      className={`p-1.5 rounded-lg transition-colors shrink-0 cursor-pointer ${
                        isFav ? 'text-red-400' : 'text-slate-500 hover:text-slate-200'
                      }`}
                    >
                      <Heart className={`w-4 h-4 ${isFav ? 'fill-current' : ''}`} />
                    </button>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-800/70">
                    <div className="text-xs text-slate-400 truncate">
                      <span>{ch.group}</span>
                      <span className="mx-1.5" aria-hidden="true">·</span>
                      <span className="font-mono uppercase">{ch.format}</span>
                    </div>
                    <span
                      className={`text-xs font-medium whitespace-nowrap shrink-0 ${
                        isActive ? 'text-red-400' : 'text-slate-300'
                      }`}
                    >
                      {isActive ? 'Diputar' : 'Tonton →'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
