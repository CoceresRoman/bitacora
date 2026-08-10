import { Inject, Injectable } from '@nestjs/common';
import { RawSignal, signalHash, SignalSource } from '../../core/signal.entity';
import { SourcePort } from '../../core/ports/source.port';
import { GitCommit, LocalGitReader } from './local-git.reader';
import { GithubEventsReader } from './github-events.reader';

export interface GitActivityConfig {
  username: string;
  repoPaths: string[];
  token?: string;
}

export const GIT_ACTIVITY_CONFIG = Symbol('GitActivityConfig');

const NOISE = /^(chore|ci|build|style)(\(|:)|^Merge |^Revert /i;

@Injectable()
export class GitActivitySource implements SourcePort {
  readonly source: SignalSource = 'git';

  constructor(
    private readonly local: LocalGitReader,
    private readonly remote: GithubEventsReader,
    @Inject(GIT_ACTIVITY_CONFIG) private readonly config: GitActivityConfig,
  ) {}

  async collect(since: Date): Promise<RawSignal[]> {
    const [local, remote] = await Promise.all([
      this.local.read(this.config.repoPaths, since),
      this.remote.read(this.config.username, since, this.config.token),
    ]);

    const bySha = new Map<string, GitCommit>();
    for (const commit of [...local, ...remote]) {
      if (NOISE.test(commit.subject)) continue;
      if (!bySha.has(commit.sha)) bySha.set(commit.sha, commit);
    }

    return [...bySha.values()].map((commit) => {
      const payload = [commit.subject, commit.body].filter(Boolean).join('\n\n');
      return {
        id: '',
        source: 'git' as const,
        kind: 'commit',
        payload,
        refs: [`${commit.repo}@${commit.sha}`],
        capturedAt: commit.at,
        hash: signalHash('git', payload),
      };
    });
  }
}
