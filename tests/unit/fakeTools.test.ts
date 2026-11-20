import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeToolDir, SPECS } from '../helpers/fakeTools';

describe.skipIf(process.platform === 'win32')('CLIs falsas (helper de teste)', () => {
  let fake: FakeToolDir;
  afterEach(() => fake.cleanup());

  it('responde conforme o spec e cria ferramentas ao "instalar"', () => {
    fake = new FakeToolDir();
    const npm = fake.add('npm', { 'install -g x': { stdout: 'added 1 package\n', create: { claude: SPECS.claude(true) } } });
    expect(execFileSync(npm, ['install', '-g', 'x'], { env: {} }).toString()).toContain('added 1 package');
    const claude = join(fake.dir, 'claude');
    expect(existsSync(claude)).toBe(true);
    expect(execFileSync(claude, ['--version'], { env: {} }).toString()).toContain('Claude Code');
  });
});
