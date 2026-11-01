// Ad-hoc sign the Mac app after packaging so it runs on Apple Silicon without a paid Developer ID.
// (Gatekeeper will still ask users to right-click > Open the first time.)
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async (ctx) => {
  if (ctx.electronPlatformName !== 'darwin' || process.env.CSC_LINK) return;
  const app = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'inherit' });
};
