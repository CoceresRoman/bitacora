import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SOURCE_PORTS } from '../core/ports/source.port';
import type { Env } from '../config/env.schema';
import { LocalGitReader } from './git-activity/local-git.reader';
import { GithubEventsReader } from './git-activity/github-events.reader';
import { GitActivitySource, GIT_ACTIVITY_CONFIG } from './git-activity/git-activity.source';
import { TrendsSource, TRENDS_CONFIG } from './trends/trends.source';
import { InboxSource } from './inbox/inbox.source';

@Module({
  providers: [
    LocalGitReader,
    GithubEventsReader,
    InboxSource,
    {
      provide: GIT_ACTIVITY_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        username: config.get('GITHUB_USERNAME', { infer: true }),
        repoPaths: config.get('LOCAL_REPOS', { infer: true }),
        token: config.get('GITHUB_TOKEN', { infer: true }),
      }),
    },
    {
      provide: TRENDS_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        repos: config.get('TRENDS_REPOS', { infer: true }),
      }),
    },
    GitActivitySource,
    TrendsSource,
    {
      provide: SOURCE_PORTS,
      inject: [GitActivitySource, TrendsSource, InboxSource],
      useFactory: (git: GitActivitySource, trends: TrendsSource, inbox: InboxSource) => [
        git,
        trends,
        inbox,
      ],
    },
  ],
  exports: [SOURCE_PORTS, InboxSource],
})
export class SourcesModule {}
