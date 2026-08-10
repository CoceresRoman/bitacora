import { Injectable, Logger } from '@nestjs/common';
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
// ASCII unit/record separators: they cannot appear in a commit message.
const FIELD = '\x1f';
const RECORD = '\x1e';

export interface GitCommit {
  repo: string;
  sha: string;
  subject: string;
  body: string;
  at: Date;
}

@Injectable()
export class LocalGitReader {
  private readonly logger = new Logger(LocalGitReader.name);

  async read(repoPaths: string[], since: Date): Promise<GitCommit[]> {
    const results = await Promise.all(repoPaths.map((path) => this.readOne(path, since)));
    return results.flat();
  }

  private async readOne(repoPath: string, since: Date): Promise<GitCommit[]> {
    try {
      // Pass the cutoff as a raw Unix epoch via --max-age rather than
      // --since=<ISO string>: git's own date parser mis-parses ISO strings
      // for years >= 2100 on this host (verified against git 2.53.0),
      // silently failing to filter anything out. `--since=@<epoch>` was also
      // observed to be unreliable here; `--max-age=<epoch>` (no `@` prefix)
      // consistently filters correctly, so it is used instead.
      const sinceEpochSeconds = Math.floor(since.getTime() / 1000);
      const { stdout } = await run(
        'git',
        [
          'log',
          `--max-age=${sinceEpochSeconds}`,
          `--pretty=format:%H${FIELD}%s${FIELD}%b${FIELD}%aI${RECORD}`,
          '--no-merges',
        ],
        { cwd: repoPath, maxBuffer: 10 * 1024 * 1024 },
      );
      return stdout
        .split(RECORD)
        .map((record) => record.trim())
        .filter((record) => record.length > 0)
        .map((record) => {
          const [sha, subject, body, at] = record.split(FIELD);
          return { repo: basename(repoPath), sha, subject, body: body.trim(), at: new Date(at) };
        });
    } catch (error) {
      this.logger.warn(`Skipping ${repoPath}: ${(error as Error).message}`);
      return [];
    }
  }
}
