import { Injectable, Logger } from '@nestjs/common';
import { GitCommit } from './local-git.reader';

interface GithubPushEvent {
  type: string;
  created_at: string;
  repo: { name: string };
  payload: { commits?: Array<{ sha: string; message: string }> };
}

@Injectable()
export class GithubEventsReader {
  private readonly logger = new Logger(GithubEventsReader.name);

  async read(username: string, since: Date, token?: string): Promise<GitCommit[]> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'bitacora',
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    try {
      const response = await fetch(
        `https://api.github.com/users/${encodeURIComponent(username)}/events/public?per_page=100`,
        { headers },
      );
      if (!response.ok) {
        this.logger.warn(`GitHub events request failed with status ${response.status}`);
        return [];
      }
      const events = (await response.json()) as GithubPushEvent[];
      return events
        .filter((event) => event.type === 'PushEvent' && new Date(event.created_at) >= since)
        .flatMap((event) =>
          (event.payload.commits ?? []).map((commit) => ({
            repo: event.repo.name,
            sha: commit.sha,
            subject: commit.message.split('\n')[0],
            body: commit.message.split('\n').slice(1).join('\n').trim(),
            at: new Date(event.created_at),
          })),
        );
    } catch (error) {
      this.logger.warn(`GitHub events unreachable: ${(error as Error).message}`);
      return [];
    }
  }
}
