export type StreamFormat = 'hls' | 'dash' | 'mp4' | 'stream';

export interface ChannelHeaders {
  userAgent?: string;
  referrer?: string;
  origin?: string;
  custom?: Record<string, string>;
}

export interface ChannelDrm {
  licenseType?: string;
  licenseKey?: string;
}

export interface Channel {
  id: string;
  number: number;
  name: string;
  group: string;
  tvgId: string;
  tvgName: string;
  logo: string;
  url: string;
  format: StreamFormat;
  headers: ChannelHeaders;
  drm?: ChannelDrm;
}

export interface CategorySummary {
  name: string;
  count: number;
}

export interface PlaylistResponse {
  sourceUrl: string;
  fetchedAt: string;
  totalChannels: number;
  categories: CategorySummary[];
  channels: Channel[];
}
