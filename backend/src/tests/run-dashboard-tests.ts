import { strict as assert } from 'assert';
import { exec as _exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { DatabaseService } from '../database/database.js';
import { GitService } from '../services/git.js';
import { listRepositoryDocs, readRepositoryDoc } from '../utils/repositoryDocs.js';

const exec = promisify(_exec);

async function setupTempRepo(rootDir: string): Promise<string> {
  const repoDir = path.join(rootDir, 'repo-dashboard-test');
  await fs.mkdir(repoDir, { recursive: true });
  await exec('git init', { cwd: repoDir });
  // Ensure main branch
  try {
    await exec('git checkout -b main', { cwd: repoDir });
  } catch {
    // Some environments already on main
  }
  // User config (in case git requires it to commit)
  await exec('git config user.email "test@example.com"', { cwd: repoDir });
  await exec('git config user.name "Test User"', { cwd: repoDir });

  // Create docs
  await fs.writeFile(path.join(repoDir, 'README.md'), '# Readme\n\nHello', 'utf-8');
  await fs.mkdir(path.join(repoDir, 'docs', 'planning'), { recursive: true });
  await fs.writeFile(path.join(repoDir, 'docs', 'planning', 'plan.md'), '# Plan\n\nStuff', 'utf-8');

  // Commit
  await exec('git add .', { cwd: repoDir });
  await exec('git commit -m "init"', { cwd: repoDir });

  // Add a remote (fake)
  await exec('git remote add origin git@github.com:user/repo.git', { cwd: repoDir });

  // Add another commit to have a small graph
  await fs.writeFile(path.join(repoDir, 'CLAUDE.md'), '# Claude\n', 'utf-8');
  await exec('git add CLAUDE.md', { cwd: repoDir });
  await exec('git commit -m "add CLAUDE"', { cwd: repoDir });

  return repoDir;
}

async function run() {
  const workRoot = path.join(process.cwd(), 'backend', '.tmp-tests');
  await fs.mkdir(workRoot, { recursive: true });
  const repoPath = await setupTempRepo(workRoot);

  const db = new DatabaseService(':memory:');
  const git = new GitService(db);

  const repo = await git.addRepository(repoPath);
  assert.ok(repo.id, 'repository has id');
  assert.equal(repo.mainBranch === 'main' || repo.mainBranch === 'master', true, 'mainBranch inferred');

  // Remotes
  const remotes = await git.getGitRemotes(repo.id);
  assert.ok(Array.isArray(remotes) && remotes.length >= 1, 'remotes found');
  assert.equal(remotes[0].name, 'origin');

  // Branches
  const branches = await git.getGitBranches(repo.id);
  const hasMain = branches.some(b => b.name === 'main');
  assert.equal(hasMain, true, 'has main branch');

  // Graph
  const graph = await git.getGitGraph(repo.id);
  assert.ok(graph.length >= 2, 'graph has commits');

  // Docs list
  const docs = await listRepositoryDocs(repoPath);
  const names = docs.map(d => d.name.toLowerCase());
  assert.equal(names.includes('readme.md'), true, 'README listed');
  assert.equal(names.includes('plan.md'), true, 'plan.md listed');

  // Doc content
  const readme = await readRepositoryDoc(repoPath, 'README.md');
  assert.ok(readme.includes('# Readme'));

  console.log('Dashboard tests passed.');
}

run().catch(err => {
  console.error('Dashboard tests failed:', err);
  process.exit(1);
});

