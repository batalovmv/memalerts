import { execSync } from 'node:child_process';
import fs from 'node:fs';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function trySh(cmd) {
  try {
    return { ok: true, out: sh(cmd) };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const version = String(pkg?.version || '').trim();
if (!version) fail('guard-prod-from-beta: package.json version is missing');

const branch = sh('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') fail(`guard-prod-from-beta: expected branch "main", got "${branch}"`);

const dirty = sh('git status --porcelain');
if (dirty) fail('guard-prod-from-beta: working tree is not clean (commit/stash changes first)');

const head = sh('git rev-parse HEAD');
const originMain = trySh('git rev-parse origin/main');
if (!originMain.ok) {
  fail('guard-prod-from-beta: origin/main is missing. Run: git fetch origin main --tags --prune');
}
if (originMain.out !== head) {
  fail(`guard-prod-from-beta: HEAD (${head}) is not equal to origin/main (${originMain.out}). Run: git pull --ff-only origin main`);
}

const betaTag = `beta-${version}`;
const beta = trySh(`git rev-parse ${betaTag}^{}`);
if (!beta.ok) {
  fail(`guard-prod-from-beta: missing required tag "${betaTag}" (deploy to beta first via deploy-dev.md)`);
}
if (beta.out !== head) {
  fail(`guard-prod-from-beta: "${betaTag}" points to ${beta.out}, but HEAD is ${head}. Tag beta from the same commit you want to promote.`);
}

const prodTag = `prod-${version}`;
const prod = trySh(`git rev-parse ${prodTag}^{}`);
if (prod.ok) {
  fail(`guard-prod-from-beta: prod tag "${prodTag}" already exists (${prod.out}). Refusing to re-release same version.`);
}

process.stdout.write(`OK: can tag ${prodTag} from ${betaTag} (${version})\n`);


