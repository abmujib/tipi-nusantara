import { useCallback, useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import * as dashjs from 'dashjs';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Heart,
  Maximize2,
  Pause,
  PictureInPicture2,
  Play,
  RefreshCw,
  Tv,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { Channel } from '../types/channel';
import { ChannelLogo } from './ChannelLogo';

interface VideoPlayerProps {
  channel: Channel | null;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  onPrevChannel: () => void;
  onNextChannel: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

function buildProxyStreamUrl(channel: Channel, targetUrl?: string): string {
  const params = new URLSearchParams();
  params.set('url', targetUrl || channel.url);
  if (channel.headers.userAgent) params.set('ua', channel.headers.userAgent);
  if (channel.headers.referrer) params.set('ref', channel.headers.referrer);
  if (channel.headers.origin) params.set('orig', channel.headers.origin);
  return `/api/stream-proxy?${params.toString()}`;
}

function downloadSingleChannelM3u(channel: Channel) {
  const lines = ['#EXTM3U'];
  const attrs: string[] = [];
  if (channel.tvgId) attrs.push(`tvg-id="${channel.tvgId}"`);
  if (channel.logo) attrs.push(`tvg-logo="${channel.logo}"`);
  if (channel.group) attrs.push(`group-title="${channel.group}"`);
  lines.push(`#EXTINF:-1 ${attrs.join(' ')},${channel.name}`);
  if (channel.headers.userAgent) {
    lines.push(`#EXTVLCOPT:http-user-agent=${channel.headers.userAgent}`);
  }
  if (channel.headers.referrer) {
    lines.push(`#EXTVLCOPT:http-referrer=${channel.headers.referrer}`);
  }
  if (channel.headers.origin) {
    lines.push(`#EXTVLCOPT:http-origin=${channel.headers.origin}`);
  }
  lines.push(channel.url);

  const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' });
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `${channel.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.m3u`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(objectUrl);
}

function base64UrlToHex(b64u: string): string {
  const pad = b64u.length % 4 === 0 ? '' : '='.repeat(4 - (b64u.length % 4));
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const bin = atob(b64);
  return Array.from(bin)
    .map((c) => c.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
}

export function VideoPlayer({
  channel,
  isFavorite,
  onToggleFavorite,
  onPrevChannel,
  onNextChannel,
  hasPrev,
  hasNext,
}: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const dashRef = useRef<dashjs.MediaPlayerClass | null>(null);

  const [useProxy, setUseProxy] = useState(true);
  const [playbackState, setPlaybackState] = useState<PlaybackState>('idle');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(0.85);
  const [resolution, setResolution] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  const cleanupPlayer = useCallback(() => {
    if (hlsRef.current) {
      hlsRef.current.destroy();
      hlsRef.current = null;
    }
    if (dashRef.current) {
      try {
        dashRef.current.destroy();
      } catch {
        // Ignore dashjs destroy race errors
      }
      dashRef.current = null;
    }
    const video = videoRef.current;
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
    }
  }, []);

  useEffect(() => {
    if (!channel) {
      cleanupPlayer();
      setPlaybackState('idle');
      setErrorMessage('');
      setResolution('');
      return;
    }

    const video = videoRef.current;
    if (!video) return;

    let cancelled = false;
    cleanupPlayer();
    setPlaybackState('loading');
    setErrorMessage('');
    setResolution('');

    const isWidevine = channel.drm?.licenseType?.toLowerCase().includes('widevine');
    const isDash = channel.format === 'dash';
    const isMp4 = channel.format === 'mp4';

    const streamSourceUrl = useProxy ? buildProxyStreamUrl(channel) : channel.url;

    const handlePlaying = () => {
      if (cancelled) return;
      setPlaybackState('playing');
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setResolution(`${video.videoWidth}×${video.videoHeight}`);
      }
    };

    const handlePause = () => {
      if (cancelled) return;
      setPlaybackState((prev) => (prev === 'error' ? 'error' : 'paused'));
    };

    const handleLoadedMeta = () => {
      if (cancelled) return;
      if (video.videoWidth > 0 && video.videoHeight > 0) {
        setResolution(`${video.videoWidth}×${video.videoHeight}`);
      }
    };

    const handleVideoError = () => {
      if (cancelled) return;
      setPlaybackState('error');
      setErrorMessage(
        isWidevine
          ? 'Stream ini memakai proteksi DRM Widevine atau terenkripsi yang tidak dapat diputar langsung tanpa server lisensi.'
          : 'Stream gagal dimuat. Server sumber mungkin sedang offline, diblokir geografis, atau membutuhkan pemutar eksternal seperti VLC.'
      );
    };

    video.addEventListener('playing', handlePlaying);
    video.addEventListener('pause', handlePause);
    video.addEventListener('loadedmetadata', handleLoadedMeta);
    video.addEventListener('error', handleVideoError);

    const startPlayback = async () => {
      if (isDash) {
        try {
          const player = dashjs.MediaPlayer().create();
          dashRef.current = player;

          if (useProxy) {
            player.addRequestInterceptor(async (request) => {
              if (
                request.url &&
                /^https?:\/\//i.test(request.url) &&
                !request.url.includes('/api/stream-proxy')
              ) {
                request.url = buildProxyStreamUrl(channel, request.url);
              }
              return request;
            });
          }

          // ClearKey DRM support when provided in playlist
          if (
            channel.drm?.licenseType?.toLowerCase().includes('clearkey') &&
            channel.drm.licenseKey
          ) {
            const lk = channel.drm.licenseKey;
            if (/^https?:\/\//i.test(lk)) {
              try {
                const ckParams = new URLSearchParams({ url: lk });
                if (channel.headers.userAgent) ckParams.set('ua', channel.headers.userAgent);
                if (channel.headers.referrer) ckParams.set('ref', channel.headers.referrer);
                const ckRes = await fetch(`/api/clearkey?${ckParams.toString()}`);
                if (ckRes.ok) {
                  const ckData = (await ckRes.json()) as {
                    keys?: Array<{ kty?: string; k?: string; kid?: string }>;
                  };
                  if (Array.isArray(ckData.keys) && ckData.keys.length > 0) {
                    const clearkeys: Record<string, string> = {};
                    for (const item of ckData.keys) {
                      if (item.kid && item.k) {
                        clearkeys[base64UrlToHex(item.kid)] = base64UrlToHex(item.k);
                      }
                    }
                    if (Object.keys(clearkeys).length > 0) {
                      player.setProtectionData({
                        'org.w3.clearkey': { clearkeys },
                      });
                    }
                  }
                }
              } catch {
                // Continue even if ClearKey pre-fetch fails
              }
            }
          }

          player.on(dashjs.MediaPlayer.events.ERROR, () => {
            if (cancelled) return;
            setPlaybackState('error');
            setErrorMessage(
              'Stream MPEG-DASH gagal diputar di browser. Coba ganti mode Proxy/Langsung atau buka URL di VLC.'
            );
          });

          player.initialize(video, streamSourceUrl, true);
          player.setMute(isMuted);
          player.setVolume(volume);
        } catch {
          if (!cancelled) {
            setPlaybackState('error');
            setErrorMessage('Gagal menginisialisasi pemutar MPEG-DASH.');
          }
        }
        return;
      }

      if (isMp4) {
        video.src = streamSourceUrl;
        video.muted = isMuted;
        video.volume = volume;
        video.play().catch(() => {
          if (!cancelled) setPlaybackState('paused');
        });
        return;
      }

      // Default: HLS (.m3u8) or generic stream via hls.js
      if (Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          maxBufferLength: 30,
        });
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, (_evt, data) => {
          if (cancelled) return;
          const level = data.levels?.[0];
          if (level && level.width && level.height) {
            setResolution(`${level.width}×${level.height}`);
          }
          video.muted = isMuted;
          video.volume = volume;
          video.play().catch(() => {
            if (!cancelled) setPlaybackState('paused');
          });
        });

        hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
          const level = hls.levels?.[data.level];
          if (level && level.width && level.height) {
            setResolution(`${level.width}×${level.height}`);
          }
        });

        hls.on(Hls.Events.ERROR, (_evt, data) => {
          if (cancelled) return;
          if (data.fatal) {
            if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
              setPlaybackState('error');
              setErrorMessage(
                'Koneksi ke stream terputus atau sumber tidak merespons (HTTP/CORS/Geo-block). Coba pindah mode Proxy/Langsung atau salin URL untuk VLC.'
              );
            } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
              hls.recoverMediaError();
            } else {
              setPlaybackState('error');
              setErrorMessage('Format stream tidak dapat didekode oleh browser ini.');
            }
          }
        });

        hls.loadSource(streamSourceUrl);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = streamSourceUrl;
        video.muted = isMuted;
        video.volume = volume;
        video.play().catch(() => {
          if (!cancelled) setPlaybackState('paused');
        });
      } else {
        setPlaybackState('error');
        setErrorMessage('Browser ini tidak mendukung pemutaran HLS.');
      }
    };

    startPlayback();

    return () => {
      cancelled = true;
      video.removeEventListener('playing', handlePlaying);
      video.removeEventListener('pause', handlePause);
      video.removeEventListener('loadedmetadata', handleLoadedMeta);
      video.removeEventListener('error', handleVideoError);
      cleanupPlayer();
    };
  }, [channel, useProxy, reloadNonce, cleanupPlayer]);

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video || !channel) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const toggleMute = () => {
    const video = videoRef.current;
    const next = !isMuted;
    setIsMuted(next);
    if (video) video.muted = next;
  };

  const handleVolumeChange = (val: number) => {
    setVolume(val);
    if (val > 0 && isMuted) setIsMuted(false);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
  };

  const handleFullscreen = () => {
    const target = containerRef.current;
    if (!target) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      target.requestFullscreen().catch(() => {});
    }
  };

  const handlePiP = () => {
    const video = videoRef.current;
    if (!video || !document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture().catch(() => {});
    } else {
      video.requestPictureInPicture().catch(() => {});
    }
  };

  const handleCopyUrl = async () => {
    if (!channel) return;
    try {
      await navigator.clipboard.writeText(channel.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback ignored
    }
  };

  return (
    <section
      aria-label="Pemutar Live Streaming"
      className="bg-[#111621] border border-slate-800/90 rounded-xl overflow-hidden"
    >
      {/* Video Viewport */}
      <div
        ref={containerRef}
        className="relative aspect-video w-full bg-[#06080C] flex items-center justify-center overflow-hidden"
      >
        <video
          ref={videoRef}
          playsInline
          className="w-full h-full object-contain bg-black"
        />

        {!channel && (
          <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-[#090C12]">
            <div className="w-14 h-14 rounded-xl bg-[#151B28] border border-slate-800 flex items-center justify-center mb-4">
              <Tv className="w-6 h-6 text-slate-400" />
            </div>
            <h2 className="font-display text-lg font-semibold text-slate-100">
              Pilih Saluran untuk Memulai Siaran
            </h2>
            <p className="text-sm text-slate-400 mt-1.5 max-w-md">
              Klik salah satu saluran dari daftar siaran di bawah untuk memutar live streaming langsung di browser.
            </p>
          </div>
        )}

        {channel && playbackState === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/75 p-6 text-center pointer-events-none">
            <div className="w-9 h-9 border-2 border-slate-700 border-t-red-500 rounded-full animate-spin mb-3" />
            <p className="text-sm font-medium text-slate-200">
              Menghubungkan ke {channel.name}...
            </p>
            <p className="text-xs text-slate-400 mt-1 font-mono">
              {useProxy ? 'Rute Proxy Server' : 'Koneksi Langsung'} · {channel.format.toUpperCase()}
            </p>
          </div>
        )}

        {channel && playbackState === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#090C12]/95 p-6 text-center">
            <div className="w-11 h-11 rounded-lg bg-red-950/60 border border-red-900/60 flex items-center justify-center mb-3">
              <AlertTriangle className="w-5 h-5 text-red-400" />
            </div>
            <h3 className="font-display text-base font-semibold text-slate-100 max-w-md">
              Siaran Tidak Dapat Diputar di Browser
            </h3>
            <p className="text-xs sm:text-sm text-slate-400 mt-1.5 max-w-lg leading-relaxed">
              {errorMessage}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2.5 mt-5">
              <button
                type="button"
                onClick={() => setUseProxy((prev) => !prev)}
                className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {useProxy ? 'Coba Koneksi Langsung' : 'Coba Mode Proxy'}
              </button>
              <button
                type="button"
                onClick={() => setReloadNonce((n) => n + 1)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Muat Ulang Stream</span>
              </button>
              <button
                type="button"
                onClick={() => downloadSingleChannelM3u(channel)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Buka di VLC (.m3u)</span>
              </button>
              {hasNext && (
                <button
                  type="button"
                  onClick={onNextChannel}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-medium text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <span>Saluran Berikutnya</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Player Control Strip */}
      <div className="px-4 py-3.5 border-t border-slate-800/80 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Active Channel Identity */}
        <div className="flex items-center gap-3.5 min-w-0">
          {channel ? (
            <>
              <ChannelLogo src={channel.logo} name={channel.name} size="md" />
              <div className="min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="font-mono text-xs text-slate-500 tabular-nums shrink-0">
                    {String(channel.number).padStart(3, '0')}
                  </span>
                  <h2 className="font-display text-base font-semibold text-slate-100 truncate">
                    {channel.name}
                  </h2>
                </div>
                <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-400 mt-0.5">
                  <span>{channel.group}</span>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono uppercase">{channel.format}</span>
                  {resolution && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-300">{resolution}</span>
                    </>
                  )}
                  {playbackState === 'playing' && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1.5 text-red-400 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" aria-hidden="true" />
                        Live
                      </span>
                    </>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="text-sm text-slate-400">Belum ada saluran aktif</div>
          )}
        </div>

        {/* Functional Controls */}
        <div className="flex items-center flex-wrap gap-2 shrink-0">
          <div className="flex items-center gap-1 bg-[#0B0E14] border border-slate-800 rounded-lg p-1">
            <button
              type="button"
              onClick={onPrevChannel}
              disabled={!hasPrev}
              title="Saluran sebelumnya"
              aria-label="Saluran sebelumnya"
              className="p-1.5 rounded-md text-slate-300 hover:bg-slate-800 disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={togglePlayPause}
              disabled={!channel}
              title={playbackState === 'playing' ? 'Jeda' : 'Putar'}
              aria-label={playbackState === 'playing' ? 'Jeda' : 'Putar'}
              className="p-1.5 rounded-md bg-red-600 hover:bg-red-500 text-white disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              {playbackState === 'playing' ? (
                <Pause className="w-4 h-4" />
              ) : (
                <Play className="w-4 h-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onNextChannel}
              disabled={!hasNext}
              title="Saluran berikutnya"
              aria-label="Saluran berikutnya"
              className="p-1.5 rounded-md text-slate-300 hover:bg-slate-800 disabled:opacity-35 disabled:pointer-events-none transition-colors cursor-pointer"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 bg-[#0B0E14] border border-slate-800 rounded-lg px-2.5 py-1.5">
            <button
              type="button"
              onClick={toggleMute}
              aria-label={isMuted ? 'Nyalakan suara' : 'Bisukan suara'}
              className="text-slate-300 hover:text-white transition-colors cursor-pointer"
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-4 h-4 text-slate-400" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              aria-label="Volume"
              className="w-16 accent-red-500 cursor-pointer"
            />
          </div>

          <button
            type="button"
            onClick={() => setUseProxy((p) => !p)}
            disabled={!channel}
            title="Ubah rute koneksi stream (Proxy server vs Langsung)"
            className={`px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
              useProxy
                ? 'bg-slate-800 border-slate-700 text-slate-100'
                : 'bg-[#0B0E14] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            {useProxy ? 'Mode: Proxy' : 'Mode: Langsung'}
          </button>

          {channel && (
            <>
              <button
                type="button"
                onClick={() => onToggleFavorite(channel.id)}
                aria-label={isFavorite ? 'Hapus dari favorit' : 'Tambah ke favorit'}
                className={`p-2 rounded-lg border transition-colors cursor-pointer ${
                  isFavorite
                    ? 'bg-red-950/50 border-red-800/70 text-red-400'
                    : 'bg-[#0B0E14] border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
              </button>

              <button
                type="button"
                onClick={handleCopyUrl}
                title="Salin URL stream"
                aria-label="Salin URL stream"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#0B0E14] border border-slate-800 text-xs font-medium text-slate-300 hover:text-white hover:border-slate-700 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copied ? 'Tersalin' : 'Salin URL'}</span>
              </button>

              <button
                type="button"
                onClick={() => downloadSingleChannelM3u(channel)}
                title="Unduh file .m3u untuk VLC"
                aria-label="Unduh file .m3u untuk VLC"
                className="p-2 rounded-lg bg-[#0B0E14] border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handlePiP}
                title="Picture-in-Picture"
                aria-label="Picture-in-Picture"
                className="hidden sm:inline-flex p-2 rounded-lg bg-[#0B0E14] border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                <PictureInPicture2 className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleFullscreen}
                title="Layar penuh"
                aria-label="Layar penuh"
                className="p-2 rounded-lg bg-[#0B0E14] border border-slate-800 text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
