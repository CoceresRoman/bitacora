import { Inject, Injectable, Logger } from '@nestjs/common';
import { RawSignal, signalHash, SignalSource } from '../../core/signal.entity';
import { SourcePort } from '../../core/ports/source.port';

export interface TrendsConfig {
  repos: string[];
}

export const TRENDS_CONFIG = Symbol('TrendsConfig');

const MIN_HN_POINTS = 150;
const HN_URL = 'https://hn.algolia.com/api/v1/search?tags=front_page';

interface HnHit {
  objectID: string;
  title: string;
  url: string | null;
  points: number;
}

interface GithubRelease {
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  published_at: string;
}

@Injectable()
export class TrendsSource implements SourcePort {
  readonly source: SignalSource = 'trends';
  private readonly logger = new Logger(TrendsSource.name);

  constructor(@Inject(TRENDS_CONFIG) private readonly config: TrendsConfig) {}

  async collect(since: Date): Promise<RawSignal[]> {
    const [stories, releases] = await Promise.all([this.hackerNews(), this.releases(since)]);
    return [...stories, ...releases];
  }

  private async hackerNews(): Promise<RawSignal[]> {
    try {
      const response = await fetch(HN_URL);
      if (!response.ok) return [];
      const { hits } = (await response.json()) as { hits: HnHit[] };
      return hits
        .filter((hit) => hit.points >= MIN_HN_POINTS && hit.url)
        .map((hit) => {
          const payload = `${hit.title} (${hit.points} puntos en Hacker News)`;
          return {
            id: '',
            source: 'trends' as const,
            kind: 'hn-story',
            payload,
            refs: [hit.url as string],
            capturedAt: new Date(),
            hash: signalHash('trends', payload),
          };
        });
    } catch (error) {
      this.logger.warn(`Hacker News unreachable: ${(error as Error).message}`);
      return [];
    }
  }

  private async releases(since: Date): Promise<RawSignal[]> {
    const results = await Promise.all(
      this.config.repos.map(async (repo): Promise<RawSignal | null> => {
        try {
          const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'bitacora' },
          });
          if (!response.ok) return null;
          const release = (await response.json()) as GithubRelease;
          if (new Date(release.published_at) < since) return null;
          const payload = [
            `${repo} publicó ${release.name ?? release.tag_name}`,
            (release.body ?? '').slice(0, 1000),
          ]
            .filter(Boolean)
            .join('\n\n');
          return {
            id: '',
            source: 'trends' as const,
            kind: 'release',
            payload,
            refs: [release.html_url],
            capturedAt: new Date(release.published_at),
            hash: signalHash('trends', payload),
          };
        } catch (error) {
          this.logger.warn(`Release lookup failed for ${repo}: ${(error as Error).message}`);
          return null;
        }
      }),
    );
    return results.filter((signal): signal is RawSignal => signal !== null);
  }
}
