// The playground extension target's pre-deploy hook (#900): prune the
// `extension-v<version>` releases on the playground's releases repo down to the
// newest, then bump this target's patch version. The Firefox store refuses a
// version it already holds ("Version 0.0.1 already exists"), so every deploy
// must carry a fresh one. The lane itself is shared with the desktop target, at
// `scripts/release-lane.js`.

module.exports = (ctx) => require('../../../../scripts/release-lane.js')(ctx, { tagFamily: /^extension-v/ });
