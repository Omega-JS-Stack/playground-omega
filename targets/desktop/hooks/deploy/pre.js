// The playground desktop target's pre-deploy hook (#900, the rework of #899):
// prune the `v<version>` releases on the playground's releases repo down to the
// newest, then bump this target's patch version, so the deploy that follows
// publishes a version electron-publish has never seen (#899 redeployed 0.0.1
// forever and hit the two-hour rule instead). The lane itself is shared with the
// extension target, at `scripts/release-lane.js`.

module.exports = (ctx) => require('../../../../scripts/release-lane.js')(ctx, { tagFamily: /^v\d/ });
