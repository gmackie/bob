import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export function compiler() {
  const pin = JSON.parse(readFileSync(new URL('../compiler.json', import.meta.url), 'utf8'));
  if (process.env.FORGEC) {
    const version = execFileSync(process.env.FORGEC, ['--version'], { encoding: 'utf8' }).trim();
    if (version !== 'forgec ' + pin.version) throw new Error('Compiler version differs from compiler.json');
    return process.env.FORGEC;
  }
  const source = join(tmpdir(), 'bob-coordination-forgec', pin.sourceCommit);
  const binary = join(source, 'target', 'release', process.platform === 'win32' ? 'forgec.exe' : 'forgec');
  mkdirSync(source, { recursive: true });
  if (!existsSync(join(source, '.git'))) execFileSync('git', ['init', source], { stdio: 'inherit' });
  const head = () => execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (!existsSync(binary)) {
    execFileSync('git', ['-C', source, 'fetch', '--depth=1', pin.sourceRepository, pin.sourceCommit], { stdio: 'inherit' });
    execFileSync('git', ['-C', source, 'checkout', '--detach', 'FETCH_HEAD'], { stdio: 'inherit' });
    if (head() !== pin.sourceCommit) throw new Error('Compiler source revision mismatch');
    execFileSync('cargo', ['build', '--release', '--locked', '-p', 'forgegraph-cli'], { cwd: source, stdio: 'inherit' });
  }
  if (head() !== pin.sourceCommit) throw new Error('Cached compiler source revision mismatch');
  return binary;
}
