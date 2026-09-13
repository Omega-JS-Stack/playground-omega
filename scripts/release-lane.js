// The playground's release lane, shared by both target deploy hooks
// (#900, the rework of #899): PRUNE the target's release family on the
// playground's releases repo down to the newest one, then BUMP the target's
// patch version, so the deploy that follows publishes a version nothing has
// seen before and leaves exactly two releases live.
//
// #899 deleted the CURRENT version's release instead and redeployed 0.0.1
// forever. That failed for real: the Firefox store refuses a version it already
// holds ("Version 0.0.1 already exists"), and a republish of a live version is
// not a publish at all. A fresh version also never trips electron-publish's
// two-hour rule, which is what the delete was working around.
//
// Playground-only by construction: the releases repo is hard-coded and the
// brand guard runs FIRST, so a copy into another brand fails loudly instead of
// deleting that brand's releases. #192 migrates the target hooks that call this
// into the universal hook system when the desktop runner is reworked.

const { execFileSync } = require('child_process');
const path = require('path');
const jetpack = require('fs-jetpack');

const RELEASES_REPO = 'Omega-JS-Stack/playground-releases';
const BRAND_ID = 'playground';
const LOG_TAG = '[playground:hooks]';

/**
 * The default `gh` runner: stdout captured, stderr captured for the error.
 *
 * @param {string[]} args - The `gh` argv.
 * @returns {string} What `gh` printed.
 */
function defaultRun(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Prepare the playground for a deploy of ONE target: prune its release family,
 * then bump its patch version.
 *
 * @param {object} ctx - The deploy hook ctx.
 * @param {object} ctx.manager - The target's framework Manager.
 * @param {string} ctx.projectRoot - The target directory being deployed.
 * @param {object} options - The lane options.
 * @param {RegExp} options.tagFamily - Which release tags belong to this target (`/^v\d/`, `/^extension-v/`).
 * @param {Function} [options.run] - The `gh` runner (injected by tests).
 * @returns {Promise<void>}
 * @throws {Error} When the brand is not the playground.
 */
module.exports = async function prepareRelease({ manager, projectRoot }, { tagFamily, run = defaultRun }) {
  const brandId = manager.getConfig().brand.id;

  if (brandId !== BRAND_ID) {
    throw new Error(`scripts/release-lane.js belongs to the playground (brand.id "${BRAND_ID}") and refuses brand "${brandId}": it deletes releases on ${RELEASES_REPO}.`);
  }

  // Prune BEFORE the bump: a failed prune (no `gh` session, a rate limit) leaves
  // the tree exactly as it was, so the next attempt is the same attempt.
  prune({ tagFamily, run });
  bump({ projectRoot });
};

/**
 * Delete every release of this target's family except the newest, so the deploy
 * that follows leaves two live.
 *
 * @param {object} options - The lane options.
 * @param {RegExp} options.tagFamily - Which release tags belong to this target.
 * @param {Function} options.run - The `gh` runner.
 * @returns {void}
 */
function prune({ tagFamily, run }) {
  const releases = JSON.parse(run(['release', 'list', '--repo', RELEASES_REPO, '--json', 'tagName,publishedAt', '--limit', '100']) || '[]');
  const family = releases
    .filter((release) => tagFamily.test(release.tagName))
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

  if (family.length === 0) {
    return console.log(`${LOG_TAG} no ${tagFamily} release on ${RELEASES_REPO}, nothing to prune.`);
  }

  const [newest, ...stale] = family;

  for (const release of stale) {
    run(['release', 'delete', release.tagName, '--repo', RELEASES_REPO, '--cleanup-tag', '--yes']);
    console.log(`${LOG_TAG} deleted release ${release.tagName} and its tag on ${RELEASES_REPO}.`);
  }

  console.log(`${LOG_TAG} kept release ${newest.tagName} on ${RELEASES_REPO} (${stale.length} pruned).`);
}

/**
 * Increment the target's patch version in its package.json and in the brand
 * lock's entry for it, so the deploy publishes a version the stores and the
 * releases repo have never seen.
 *
 * @param {object} options - The lane options.
 * @param {string} options.projectRoot - The target directory being deployed.
 * @returns {void}
 */
function bump({ projectRoot }) {
  const packagePath = path.join(projectRoot, 'package.json');
  const pkg = jetpack.read(packagePath, 'json');
  const [major, minor, patch] = String(pkg.version).split('.');
  const next = `${major}.${minor}.${Number(patch) + 1}`;

  writeJson(packagePath, { ...pkg, version: next });

  // The brand lock carries its own copy of every target's version, so a bump
  // that skipped it would leave `npm ci` installing the old one.
  const brandRoot = path.resolve(projectRoot, '..', '..');
  const lockPath = path.join(brandRoot, 'package-lock.json');
  const lock = jetpack.exists(lockPath) === 'file' ? jetpack.read(lockPath, 'json') : null;
  const entry = `targets/${path.basename(projectRoot)}`;

  if (lock && lock.packages && lock.packages[entry]) {
    lock.packages[entry].version = next;
    writeJson(lockPath, lock);
  }

  console.log(`${LOG_TAG} bumped ${entry} ${pkg.version} -> ${next}.`);
}

/**
 * Write a JSON file the way npm writes them: 2-space indent, trailing newline.
 *
 * @param {string} file - Where to write.
 * @param {object} content - What to write.
 * @returns {void}
 */
function writeJson(file, content) {
  jetpack.write(file, `${JSON.stringify(content, null, 2)}\n`);
}
