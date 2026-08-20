import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const restoreScript = resolve('scripts/restore-db.sh');

test('restore fails closed when pg_restore reports a partial failure', async () => {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'ateva-restore-test-'));
  try {
    const fakeBin = join(fixtureRoot, 'bin');
    await mkdir(fakeBin);
    const dump = join(fixtureRoot, 'backup.dump.gz');
    await writeFile(dump, 'fixture');
    const commands = {
      gunzip: '#!/bin/sh\nprintf "fake dump"\n',
      pg_restore: '#!/bin/sh\ncat >/dev/null\nexit 7\n',
      // The former implementation accepted this partial restore merely
      // because psql reported at least one table. Keep the fake present so
      // this test specifically prevents that fallback from returning.
      psql: '#!/bin/sh\nprintf "1\\n"\n',
    };
    for (const [name, source] of Object.entries(commands)) {
      const path = join(fakeBin, name);
      await writeFile(path, source);
      await chmod(path, 0o700);
    }

    const result = spawnSync(
      'bash',
      [restoreScript, dump, 'postgresql://test:test@localhost:5432/restore'],
      {
        encoding: 'utf8',
        env: { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ''}` },
      },
    );

    assert.notEqual(result.status, 0);
    assert.doesNotMatch(result.stdout, /Restore complete/);
    assert.doesNotMatch(result.stderr, /checking whether restore actually succeeded/);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});
