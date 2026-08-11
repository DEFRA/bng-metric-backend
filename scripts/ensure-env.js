// The purpose of this script is to ensure the .env file exists for local development.
// If it does not exist it copies .env.template -> .env so that environment variables
// are populated from the template file.
//
// Invoked directly at the start of the `dev` npm script in package.json (not via
// npm's `pre<name>` convention — `ignore-scripts=true` in .npmrc suppresses that),
// so `npm run dev` only proceeds to the server if this exits 0.
import { copyFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(root, '.env')
const templatePath = resolve(root, '.env.template')

if (existsSync(envPath)) {
  process.exit(0)
}

if (!existsSync(templatePath)) {
  console.error(
    `[ensure-env] .env not found and no .env.template at ${templatePath}`
  )
  process.exit(1)
}

const yellow = '\x1b[33m'
const bold = '\x1b[1m'
const reset = '\x1b[0m'
const BANNER_WIDTH = 72
const bar = '='.repeat(BANNER_WIDTH)

console.warn(`${yellow}${bold}`)
console.warn(bar)
console.warn('  WARNING: .env file not found')
console.warn(bar)
console.warn(`  Expected at: ${envPath}`)
console.warn(`  Copying from: ${templatePath}`)
console.warn('  Check the new .env file and update it if required.')
console.warn(`${bar}${reset}`)

copyFileSync(templatePath, envPath)
console.log(`[ensure-env] copied ${templatePath} -> ${envPath}`)
