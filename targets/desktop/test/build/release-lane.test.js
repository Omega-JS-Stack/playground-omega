/**
 * Build-layer test: the playground's release lane
 * ([#900](https://github.com/Omega-JS-Stack/omega/issues/900)).
 *
 * `scripts/release-lane.js` is the BRAND-level helper both targets' deploy
 * hooks call: it prunes the target's release family on the playground's
 * releases repo down to the newest one, then bumps the target's patch version
 * so the deploy that follows publishes a version the stores have never seen
 * (AMO refuses a version it already holds, and electron-publish refuses a
 * release older than two hours).
 *
 * The helper is SHARED by both targets; this desktop target hosts the test
 * because its `omega test` corpus already exists (the extension target has no
 * build corpus to put it in).
 *
 * Nothing here touches the network or the real brand tree: the `gh` calls run
 * through the injected `run`, and the files live in a throwaway brand tree.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const prepareRelease = require('../../../../scripts/release-lane.js');

// What `gh release list --json tagName,publishedAt` answers on the playground's
// releases repo: both target families, out of published order on purpose.
const RELEASES = [
  { tagName: 'v0.0.3', publishedAt: '2026-09-12T03:00:00Z' },
  { tagName: 'v0.0.1', publishedAt: '2026-09-10T01:00:00Z' },
  { tagName: 'v0.0.2', publishedAt: '2026-09-11T02:00:00Z' },
  { tagName: 'extension-v0.0.1', publishedAt: '2026-09-10T04:00:00Z' },
  { tagName: 'extension-v0.0.2', publishedAt: '2026-09-11T05:00:00Z' },
];

/**
 * A throwaway brand tree (`targets/desktop` + the brand lock) plus a `gh`
 * recorder that answers the list call with the canned releases above.
 *
 * @param {string} [brandId] - What the fake manager's config reports.
 * @returns {object} The tree paths, the recorder, the calls, the fake manager.
 */
function makeBrand(brandId) {
  const brandRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'playground-release-lane-')));
  const projectRoot = path.join(brandRoot, 'targets', 'desktop');
  const calls = [];

  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(path.join(projectRoot, 'package.json'), `${JSON.stringify({ name: 'playground-desktop', version: '0.0.1', private: true }, null, 2)}\n`);
  fs.writeFileSync(path.join(brandRoot, 'package-lock.json'), `${JSON.stringify({
    name: 'playground-omega',
    lockfileVersion: 3,
    packages: {
      'targets/desktop': { name: 'playground-desktop', version: '0.0.1' },
      'targets/extension': { name: 'playground-extension', version: '0.0.1' },
    },
  }, null, 2)}\n`);

  return {
    brandRoot,
    projectRoot,
    calls,
    manager: { getConfig: () => ({ brand: { id: brandId || 'playground' } }) },
    run: (args) => {
      calls.push(args);

      return args[1] === 'list' ? JSON.stringify(RELEASES) : '';
    },
  };
}

/**
 * The tags a run asked `gh` to delete, in the order it asked.
 *
 * @param {Array<string[]>} calls - Every `gh` argv the run made.
 * @returns {string[]} The deleted tags.
 */
function deletedTags(calls) {
  return calls.filter((args) => args[1] === 'delete').map((args) => args[2]);
}

module.exports = {
  type: 'suite',
  layer: 'build',
  description: 'release-lane: the playground prunes to one release per family, then bumps',
  tests: [
    {
      name: 'prunes only its OWN tag family, keeping the newest release of it',
      run: async (ctx) => {
        const brand = makeBrand();

        await prepareRelease({ manager: brand.manager, projectRoot: brand.projectRoot }, { tagFamily: /^v\d/, run: brand.run });

        const deleted = deletedTags(brand.calls);

        // The newest (v0.0.3) survives, so the deploy leaves two live releases.
        ctx.expect(deleted.slice().sort()).toEqual(['v0.0.1', 'v0.0.2']);
        ctx.expect(deleted.includes('v0.0.3')).toBe(false);
        // The other target's family is untouched: one lane must never prune
        // the releases the other one is publishing into.
        ctx.expect(deleted.filter((tag) => tag.startsWith('extension-')).length).toBe(0);
        // Every delete cleans the tag up too, on the hard-coded releases repo.
        for (const args of brand.calls.filter((call) => call[1] === 'delete')) {
          ctx.expect(args).toContain('Omega-JS-Stack/playground-releases');
          ctx.expect(args).toContain('--cleanup-tag');
          ctx.expect(args).toContain('--yes');
        }
      },
    },

    {
      name: 'bumps the patch in the target package.json and the brand lock entry, leaving the other target alone',
      run: async (ctx) => {
        const brand = makeBrand();

        await prepareRelease({ manager: brand.manager, projectRoot: brand.projectRoot }, { tagFamily: /^v\d/, run: brand.run });

        const packageRaw = fs.readFileSync(path.join(brand.projectRoot, 'package.json'), 'utf8');
        const lockRaw = fs.readFileSync(path.join(brand.brandRoot, 'package-lock.json'), 'utf8');

        ctx.expect(JSON.parse(packageRaw).version).toBe('0.0.2');
        ctx.expect(JSON.parse(lockRaw).packages['targets/desktop'].version).toBe('0.0.2');
        // The extension target bumps on ITS own deploy, never on this one.
        ctx.expect(JSON.parse(lockRaw).packages['targets/extension'].version).toBe('0.0.1');
        // Written the way npm writes them: 2-space JSON, trailing newline.
        ctx.expect(packageRaw.endsWith('\n')).toBe(true);
        ctx.expect(lockRaw.endsWith('\n')).toBe(true);
        ctx.expect(packageRaw).toContain('\n  "version": "0.0.2"');
      },
    },

    {
      name: 'refuses a foreign brand before it touches a single release',
      run: async (ctx) => {
        const brand = makeBrand('newsflash');

        await ctx.expect(async () => {
          await prepareRelease({ manager: brand.manager, projectRoot: brand.projectRoot }, { tagFamily: /^v\d/, run: brand.run });
        }).toThrow(/playground-releases/);

        // The guard is FIRST: a copy of this hook into another brand can never
        // delete that brand's releases or rewrite its version.
        ctx.expect(brand.calls.length).toBe(0);
        ctx.expect(JSON.parse(fs.readFileSync(path.join(brand.projectRoot, 'package.json'), 'utf8')).version).toBe('0.0.1');
      },
    },
  ],
};
