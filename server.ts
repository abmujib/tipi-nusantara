import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import fs from 'fs';
import net from 'net';
import dns from 'dns/promises';
import { Readable } from 'stream';
import type { Channel, ChannelDrm, ChannelHeaders, PlaylistResponse, StreamFormat } from './src/types/channel.ts';

const DEFAULT_PLAYLIST_URL =
  'https://raw.githubusercontent.com/windozalmi/Playlist_IPTV_Pribadi/refs/heads/m3u-ipvt/IPTV%20Indonesia%20by%20WINDO%20ZALMI';

const PLAYLIST_CACHE_TTL_MS = 5 * 60 * 1000;
const playlistCache = new Map<string, { data: PlaylistResponse; expiresAt: number }>();

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80:')) return true;
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice(7);
      if (net.isIPv4(mapped)) return isPrivateIp(mapped);
    }
    return false;
  }
  return true;
}

async function validateExternalUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('URL tidak valid');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Hanya protokol HTTP/HTTPS yang didukung');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error('Host lokal tidak diizinkan');
  }

  if (net.isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw new Error('Alamat IP privat tidak diizinkan');
    }
    return parsed;
  }

  try {
    const records = await dns.lookup(hostname, { all: true });
    for (const rec of records) {
      if (isPrivateIp(rec.address)) {
        throw new Error('Host mengarah ke alamat IP privat');
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('privat')) {
      throw err;
    }
    // Allow upstream fetch to report DNS resolution failures cleanly if lookup fails
  }

  return parsed;
}

function detectFormat(url: string, manifestType?: string): StreamFormat {
  const lower = url.toLowerCase();
  const mt = (manifestType || '').toLowerCase();
  if (mt === 'mpd' || lower.includes('.mpd') || lower.includes('type=dash')) {
    return 'dash';
  }
  if (mt === 'hls' || lower.includes('.m3u8')) {
    return 'hls';
  }
  if (lower.endsWith('.mp4') || lower.includes('.mp4?')) {
    return 'mp4';
  }
  return 'stream';
}

function parseExtInfAttributes(metaPart: string): {
  attrs: Record<string, string>;
  displayName: string;
} {
  // Find the comma separating attributes from channel name, respecting quotes when balanced
  let inQuotes = false;
  let commaIndex = -1;
  for (let i = 0; i < metaPart.length; i++) {
    const ch = metaPart[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      commaIndex = i;
    }
  }

  // Fallback for malformed unclosed quotes (e.g. tvg-id="ANTV.id ... ,ANTV (Vidio))
  if (commaIndex === -1) {
    commaIndex = metaPart.lastIndexOf(',');
  }

  const attrSection = commaIndex >= 0 ? metaPart.slice(0, commaIndex) : metaPart;
  const displayName = commaIndex >= 0 ? metaPart.slice(commaIndex + 1).trim() : '';

  const attrs: Record<string, string> = {};
  const attrRegex = /([a-zA-Z0-9_-]+)="([^"]*)"/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(attrSection)) !== null) {
    attrs[match[1].toLowerCase()] = match[2].trim();
  }

  return { attrs, displayName };
}

function parseM3UPlaylist(rawText: string, sourceUrl: string): PlaylistResponse {
  const lines = rawText
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const channels: Channel[] = [];
  let pendingMeta: {
    name: string;
    group: string;
    tvgId: string;
    tvgName: string;
    logo: string;
    headers: ChannelHeaders;
    drm?: ChannelDrm;
    manifestType?: string;
  } | null = null;

  for (const line of lines) {
    if (line.startsWith('#EXTM3U')) {
      continue;
    }

    // Ignore decorative banner lines like <====...====>
    if (line.startsWith('<') && line.endsWith('>')) {
      continue;
    }

    if (line.startsWith('#EXTINF:')) {
      const metaPart = line.slice('#EXTINF:'.length);
      const { attrs, displayName } = parseExtInfAttributes(metaPart);
      pendingMeta = {
        name: displayName || attrs['tvg-name'] || attrs['tvg-id'] || 'Saluran Tanpa Nama',
        group: attrs['group-title'] || 'Lainnya',
        tvgId: attrs['tvg-id'] || '',
        tvgName: attrs['tvg-name'] || '',
        logo: attrs['tvg-logo'] || '',
        headers: {},
      };
      continue;
    }

    if (!pendingMeta) {
      continue;
    }

    if (line.startsWith('#EXTGRP:')) {
      const grp = line.slice('#EXTGRP:'.length).trim();
      if (grp && (pendingMeta.group === 'Lainnya' || !pendingMeta.group)) {
        pendingMeta.group = grp;
      }
      continue;
    }

    if (line.startsWith('#EXTVLCOPT:')) {
      const opt = line.slice('#EXTVLCOPT:'.length).trim();
      const eqIdx = opt.indexOf('=');
      if (eqIdx > 0) {
        const key = opt.slice(0, eqIdx).trim().toLowerCase();
        const val = opt.slice(eqIdx + 1).trim();
        if (key === 'http-user-agent') pendingMeta.headers.userAgent = val;
        if (key === 'http-referrer' || key === 'http-referer') pendingMeta.headers.referrer = val;
        if (key === 'http-origin') pendingMeta.headers.origin = val;
      }
      continue;
    }

    if (line.startsWith('#EXTHTTP:')) {
      const jsonStr = line.slice('#EXTHTTP:'.length).trim();
      try {
        const parsed = JSON.parse(jsonStr) as Record<string, string>;
        for (const [k, v] of Object.entries(parsed)) {
          const lower = k.toLowerCase();
          if (lower === 'user-agent' && !pendingMeta.headers.userAgent) {
            pendingMeta.headers.userAgent = v;
          } else if ((lower === 'referer' || lower === 'referrer') && !pendingMeta.headers.referrer) {
            pendingMeta.headers.referrer = v;
          } else if (lower === 'origin' && !pendingMeta.headers.origin) {
            pendingMeta.headers.origin = v;
          }
        }
      } catch {
        // Ignore malformed JSON header directive
      }
      continue;
    }

    if (line.startsWith('#KODIPROP:')) {
      const prop = line.slice('#KODIPROP:'.length).trim();
      const eqIdx = prop.indexOf('=');
      if (eqIdx > 0) {
        const key = prop.slice(0, eqIdx).trim().toLowerCase();
        const val = prop.slice(eqIdx + 1).trim();
        if (key === 'inputstream.adaptive.manifest_type') {
          pendingMeta.manifestType = val;
        } else if (key === 'inputstream.adaptive.license_type') {
          pendingMeta.drm = { ...(pendingMeta.drm || {}), licenseType: val };
        } else if (key === 'inputstream.adaptive.license_key') {
          pendingMeta.drm = { ...(pendingMeta.drm || {}), licenseKey: val };
        } else if (key === 'inputstream.adaptive.stream_headers') {
          const pairs = val.split('|');
          for (const pair of pairs) {
            const pIdx = pair.indexOf('=');
            if (pIdx > 0) {
              const hk = pair.slice(0, pIdx).trim().toLowerCase();
              const hv = pair.slice(pIdx + 1).trim();
              if (hk === 'user-agent' && !pendingMeta.headers.userAgent) {
                pendingMeta.headers.userAgent = hv;
              } else if ((hk === 'referer' || hk === 'referrer') && !pendingMeta.headers.referrer) {
                pendingMeta.headers.referrer = hv;
              } else if (hk === 'origin' && !pendingMeta.headers.origin) {
                pendingMeta.headers.origin = hv;
              }
            }
          }
        }
      }
      continue;
    }

    if (line.startsWith('#')) {
      continue;
    }

    if (/^https?:\/\//i.test(line)) {
      const channelNumber = channels.length + 1;
      const format = detectFormat(line, pendingMeta.manifestType);
      channels.push({
        id: `ch-${channelNumber}`,
        number: channelNumber,
        name: pendingMeta.name,
        group: pendingMeta.group || 'Lainnya',
        tvgId: pendingMeta.tvgId,
        tvgName: pendingMeta.tvgName,
        logo: pendingMeta.logo,
        url: line,
        format,
        headers: pendingMeta.headers,
        drm: pendingMeta.drm,
      });
      pendingMeta = null;
    }
  }

  const categoryMap = new Map<string, number>();
  for (const ch of channels) {
    categoryMap.set(ch.group, (categoryMap.get(ch.group) || 0) + 1);
  }

  const categories = Array.from(categoryMap.entries()).map(([name, count]) => ({
    name,
    count,
  }));

  return {
    sourceUrl,
    fetchedAt: new Date().toISOString(),
    totalChannels: channels.length,
    categories,
    channels,
  };
}

function buildProxyUrl(
  targetUrl: string,
  ua?: string,
  ref?: string,
  orig?: string
): string {
  const params = new URLSearchParams();
  params.set('url', targetUrl);
  if (ua) params.set('ua', ua);
  if (ref) params.set('ref', ref);
  if (orig) params.set('orig', orig);
  return `/api/stream-proxy?${params.toString()}`;
}

function rewriteHlsManifest(
  manifestText: string,
  baseUrl: string,
  ua?: string,
  ref?: string,
  orig?: string
): string {
  const lines = manifestText.split(/\r\n|\r|\n/);
  const rewritten = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed) return line;

    // Rewrite URI="..." inside #EXT-X-KEY, #EXT-X-MAP, #EXT-X-MEDIA, etc.
    if (trimmed.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (_match, rawUri: string) => {
        try {
          const resolved = new URL(rawUri, baseUrl).toString();
          return `URI="${buildProxyUrl(resolved, ua, ref, orig)}"`;
        } catch {
          return `URI="${rawUri}"`;
        }
      });
    }

    // Segment or sub-playlist URL line
    try {
      const resolved = new URL(trimmed, baseUrl).toString();
      return buildProxyUrl(resolved, ua, ref, orig);
    } catch {
      return line;
    }
  });

  return rewritten.join('\n');
}

async function startServer() {
  const app = express();
  app.disable('x-powered-by');

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/playlist', async (req, res) => {
    const requestedUrl =
      typeof req.query.url === 'string' && req.query.url.trim()
        ? req.query.url.trim()
        : DEFAULT_PLAYLIST_URL;
    const forceRefresh = req.query.refresh === '1';

    try {
      const validUrl = await validateExternalUrl(requestedUrl);
      const cacheKey = validUrl.toString();

      if (!forceRefresh) {
        const cached = playlistCache.get(cacheKey);
        if (cached && cached.expiresAt > Date.now()) {
          res.json(cached.data);
          return;
        }
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      const upstream = await fetch(cacheKey, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: 'text/plain, application/x-mpegURL, */*',
        },
      });
      clearTimeout(timeout);

      if (!upstream.ok) {
        res.status(502).json({
          error: `Gagal mengambil playlist dari sumber (HTTP ${upstream.status})`,
        });
        return;
      }

      const text = await upstream.text();
      if (!text.includes('#EXTINF') && !text.includes('#EXTM3U')) {
        res.status(400).json({
          error: 'File yang diambil bukan format playlist M3U yang valid.',
        });
        return;
      }

      const parsed = parseM3UPlaylist(text, cacheKey);
      playlistCache.set(cacheKey, {
        data: parsed,
        expiresAt: Date.now() + PLAYLIST_CACHE_TTL_MS,
      });

      res.json(parsed);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Gagal memuat playlist M3U';
      res.status(400).json({ error: message });
    }
  });

  app.get('/api/stream-proxy', async (req, res) => {
    const rawTarget = typeof req.query.url === 'string' ? req.query.url : '';
    const ua = typeof req.query.ua === 'string' ? req.query.ua : undefined;
    const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined;
    const orig = typeof req.query.orig === 'string' ? req.query.orig : undefined;

    if (!rawTarget) {
      res.status(400).json({ error: 'Parameter url wajib diisi' });
      return;
    }

    try {
      const validated = await validateExternalUrl(rawTarget);
      const headers: Record<string, string> = {
        'User-Agent':
          ua ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept: '*/*',
      };
      if (ref) headers['Referer'] = ref;
      if (orig) headers['Origin'] = orig;
      if (typeof req.headers.range === 'string') {
        headers['Range'] = req.headers.range;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const upstream = await fetch(validated.toString(), {
        headers,
        redirect: 'follow',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!upstream.ok && upstream.status !== 206) {
        res.status(upstream.status).json({
          error: `Sumber stream mengembalikan HTTP ${upstream.status}`,
        });
        return;
      }

      const finalUrl = upstream.url || validated.toString();
      const contentType = (upstream.headers.get('content-type') || '').toLowerCase();
      const isHlsContentType =
        contentType.includes('mpegurl') ||
        contentType.includes('m3u') ||
        finalUrl.toLowerCase().includes('.m3u8');

      if (isHlsContentType) {
        const text = await upstream.text();
        if (text.trimStart().startsWith('#EXTM3U')) {
          const rewritten = rewriteHlsManifest(text, finalUrl, ua, ref, orig);
          res.setHeader('Content-Type', 'application/vnd.apple.mpegurl; charset=utf-8');
          res.setHeader('Cache-Control', 'no-cache');
          res.setHeader('Access-Control-Allow-Origin', '*');
          res.send(rewritten);
          return;
        }
        // Not actually an M3U8 playlist despite extension
        res.setHeader('Content-Type', contentType || 'text/plain');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.send(text);
        return;
      }

      if (contentType) {
        res.setHeader('Content-Type', contentType);
      }
      const contentLength = upstream.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);
      const acceptRanges = upstream.headers.get('accept-ranges');
      if (acceptRanges) res.setHeader('Accept-Ranges', acceptRanges);

      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'no-cache');
      res.status(upstream.status);

      if (!upstream.body) {
        res.end();
        return;
      }

      const nodeStream = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
      nodeStream.on('error', () => {
        if (!res.headersSent) res.status(502).end();
        else res.end();
      });
      nodeStream.pipe(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Stream proxy gagal';
      if (!res.headersSent) {
        res.status(502).json({ error: msg });
      }
    }
  });

  app.get('/api/clearkey', async (req, res) => {
    const rawTarget = typeof req.query.url === 'string' ? req.query.url : '';
    const ua = typeof req.query.ua === 'string' ? req.query.ua : undefined;
    const ref = typeof req.query.ref === 'string' ? req.query.ref : undefined;

    if (!rawTarget) {
      res.status(400).json({ error: 'Parameter url wajib diisi' });
      return;
    }

    try {
      const validated = await validateExternalUrl(rawTarget);
      const headers: Record<string, string> = {
        'User-Agent':
          ua ||
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      };
      if (ref) headers['Referer'] = ref;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const upstream = await fetch(validated.toString(), {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `HTTP ${upstream.status}` });
        return;
      }

      const data = await upstream.json();
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.json(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Gagal mengambil ClearKey';
      res.status(502).json({ error: msg });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
      });
    }
  }

  const port = Number(process.env.PORT) || 3000;
  app.listen(port, '0.0.0.0', () => {
    console.log(`Nusantara Stream server running on http://0.0.0.0:${port}`);
  });
}

startServer();
