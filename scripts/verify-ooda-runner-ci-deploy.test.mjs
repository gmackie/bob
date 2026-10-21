import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const script = join(root, 'apps/ooda-runner/deploy-ci.sh');
const workflow = readFileSync(join(root, '.forgejo/workflows/ci.yml'), 'utf8');
const helper = readFileSync(join(root, 'apps/ooda-runner/ops/bob-ooda-ci-service'), 'utf8');
const remote = readFileSync(join(root, 'apps/ooda-runner/ops/promote-ci-release.sh'), 'utf8');

test('runner promotion is master-push only, serialized and requires full successful CI', () => {
  const job = workflow.slice(workflow.indexOf('\n  deploy-ooda-runner:'));
  assert.match(job, /needs: ci/);
  assert.match(job, /github.event_name == 'push' && github.ref == 'refs\/heads\/master'/);
  assert.match(job, /test "\$CI_RESULT" = success/);
  assert.match(job, /cancel-in-progress: false/);
  assert.match(job, /StrictHostKeyChecking yes/);
  assert.match(job, /if: always\(\)\n        run: rm -f/);
});

test('promotion preserves environment drop-ins, checks process identity and rolls back on failure', () => {
  assert.match(helper, /ExecStart=\nExecStart=\/home\/bob\/.local\/bin\/node/);
  assert.doesNotMatch(remote, /EnvironmentFile=/);
  assert.match(remote, /\/proc\/\$pid\/cwd/);
  assert.match(remote, /\/proc\/\$pid\/cmdline/);
  assert.match(remote, /127\.0\.0\.1:3010\/health/);
  assert.match(remote, /if \$changed && \(\( status != 0 \)\)/);
  assert.match(remote, /sudo -n "\$helper" rollback "\$sha"/);
  assert.match(helper, /install -m 0644 "\$state\/previous.conf" "\$dropin"/);
  assert.match(remote, /flock -w 1200/);
  assert.match(remote, /sha256sum --check --status/);
});

test('transport validates inputs before contacting the host', () => {
  const result = spawnSync('bash', [script, 'not-a-sha'], { encoding: 'utf8', env: {} });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /exact 40-character/);
});

test('transport ships committed source only and forwards registry auth over stdin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ooda-ci-test-'));
  try {
    const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    git('init', '-b', 'master');
    git('config', 'user.name', 'CI test'); git('config', 'user.email', 'test@example.com');
    mkdirSync(join(dir, 'apps/ooda-runner/ops'), { recursive: true });
    copyFileSync(script, join(dir, 'apps/ooda-runner/deploy-ci.sh'));
    copyFileSync(join(root, 'apps/ooda-runner/ops/promote-ci-release.sh'), join(dir, 'apps/ooda-runner/ops/promote-ci-release.sh'));
    writeFileSync(join(dir, 'committed.txt'), 'committed');
    git('add', '.'); git('commit', '-m', 'fixture');
    const sha = git('rev-parse', 'HEAD');
    git('remote', 'add', 'origin', dir);
    writeFileSync(join(dir, 'untracked-secret'), 'must not ship');
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin/ssh'), `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$TEST_DIR/ssh-args"
if [[ "$2" == mktemp ]]; then echo /tmp/bob-ooda-ci.test123; fi
if [[ "$2" == *'read -r FG_REGISTRY_TOKEN'* ]]; then cat > "$TEST_DIR/payload"; fi
`, { mode: 0o755 });
    writeFileSync(join(dir, 'bin/scp'), '#!/usr/bin/env bash\ncp "$1" "$TEST_DIR/upload.tar.gz"\n', { mode: 0o755 });
    const result = spawnSync('bash', [script, sha], {
      cwd: dir, encoding: 'utf8', env: { ...process.env, PATH: `${dir}/bin:${process.env.PATH}`, TEST_DIR: dir,
        OODA_DEPLOY_TARGET: 'bob@runner.example', FG_REGISTRY_TOKEN: 'fixture-registry-secret' },
    });
    assert.equal(result.status, 0, result.stderr);
    const files = execFileSync('tar', ['-tzf', join(dir, 'upload.tar.gz')], { encoding: 'utf8' });
    assert.match(files, /committed.txt/);
    assert.doesNotMatch(files, /untracked-secret/);
    assert.ok(readFileSync(join(dir, 'payload'), 'utf8').startsWith('fixture-registry-secret\n#!/usr/bin/env bash'));
    assert.doesNotMatch(readFileSync(join(dir, 'ssh-args'), 'utf8'), /fixture-registry-secret/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
