// `npm install`, with the one workaround this repo needs to get through it.
//
// .npmrc sets min-release-age (supply-chain cooldown). npm turns that into
// --before for resolution, then passes --before to the child `npm install` it
// always spawns to prepare the bng-library *git* dependency — while that child
// also inherits npm_config_min_release_age from us. It rejects the combination
// before it reads any config file (npm/cli#9005):
//
//   npm error --min-release-age cannot be provided when using --before
//   npm error git dep preparation failed
//
// Two things have to give, because the setting reaches the child by two routes.
// Stripping the line from .npmrc is the same fix the Dockerfile and the CI
// workflows already apply — but it is not enough on its own here: when this
// runs under `npm run`, npm has already read .npmrc and exported the setting as
// npm_config_min_release_age, which the child inherits whatever the file now
// says. So the variable is dropped from the child's environment too.
//
// The difference from CI is that this is a developer's working tree, so .npmrc
// is always put back — on success, on failure, and on Ctrl-C.

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

const NPMRC = '.npmrc'
const COOLDOWN_SETTING = /^min-release-age=.*$\n?/m

const original = readFileSync(NPMRC, 'utf8')
const withoutCooldown = original.replace(COOLDOWN_SETTING, '')
const needsWorkaround = withoutCooldown !== original

let restored = false

function restoreNpmrc() {
  if (restored || !needsWorkaround) {
    return
  }
  restored = true
  writeFileSync(NPMRC, original)
}

// Ctrl-C mid-install must not leave the cooldown stripped on disk.
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    restoreNpmrc()
    process.exit(1)
  })
}

// Since the batch-file hardening in Node 18.20.2, spawning npm.cmd without a
// shell fails outright on Windows (EINVAL) and npm never starts. Under
// `npm run` — which is how lib:unlink gets here — npm_execpath points at npm's
// own cli.js, which the current node binary can run directly: no .cmd, no
// shell, nothing for that hardening to reject.
function npmInstallCommand(extraArgs) {
  const args = ['install', ...extraArgs]
  const npmCli = process.env.npm_execpath
  if (npmCli?.endsWith('.js')) {
    return { command: process.execPath, args: [npmCli, ...args], shell: false }
  }
  // Bare `node scripts/npm-install.mjs`, or an npm_execpath that is not a JS
  // file: let the shell resolve npm itself.
  return { command: 'npm', args, shell: process.platform === 'win32' }
}

try {
  if (needsWorkaround) {
    writeFileSync(NPMRC, withoutCooldown)
  }
  const env = { ...process.env }
  // npm lower-cases and underscores config keys when it exports them.
  delete env.npm_config_min_release_age
  const { command, args, shell } = npmInstallCommand(process.argv.slice(2))
  const { status, error } = spawnSync(command, args, {
    stdio: 'inherit',
    env,
    shell
  })
  restoreNpmrc()
  // A spawn that never started reports `error` with a null status — without
  // this it would surface as a bare exit 1, after lib:unlink has already
  // removed bng-library.
  if (error) {
    console.error(`Could not start npm install: ${error.message}`)
    console.error(
      'bng-library may be uninstalled — run `npm install` to restore it.'
    )
    process.exit(1)
  }
  process.exit(status ?? 1)
} finally {
  restoreNpmrc()
}
