/**
 * Publish data-dictionary/data-dictionary.md to a Confluence Cloud page.
 *
 * Invoked from .github/workflows/publish-data-dictionary.yml on merge to main
 * (the workflow's `paths` filter means it only runs when the Markdown changed).
 * The page is updated *by ID*: GET the current version, then PUT the converted
 * storage-format body with the version number incremented.
 *
 * Configuration (all via env; the workflow maps these from repo secrets/vars):
 *   CONFLUENCE_BASE_URL    Wiki base, e.g. https://defra.atlassian.net/wiki
 *   CONFLUENCE_PAGE_ID     Numeric ID of the existing page to update
 *   CONFLUENCE_USER_EMAIL  Atlassian account email (Basic-auth username)
 *   CONFLUENCE_API_TOKEN   Atlassian API token (Basic-auth password)
 *
 * Dry run — print the converted storage XHTML without contacting Confluence
 * (no credentials required):
 *   node scripts/publish-confluence.mjs --dry-run
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { markdownToStorage } from './markdown-to-confluence.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const MARKDOWN_PATH = join(HERE, '..', 'data-dictionary', 'data-dictionary.md')
const REPO_URL = 'https://github.com/DEFRA/bng-metric-backend'
const REQUIRED_ENV = [
  'CONFLUENCE_BASE_URL',
  'CONFLUENCE_PAGE_ID',
  'CONFLUENCE_USER_EMAIL',
  'CONFLUENCE_API_TOKEN'
]

// Confluence info panel making clear the page is machine-published and that
// manual edits will be overwritten on the next merge to main. The trailing `\`
// on each line strips the newline so the macro stays a single line.
const GENERATED_BANNER = `<ac:structured-macro ac:name="info"><ac:rich-text-body><p>\
Auto-generated from <a href="${REPO_URL}">bng-metric-backend</a> and republished \
on every merge to <code>main</code>. Do not edit here — changes will be \
overwritten. Update the Drizzle schema or the Joi <code>.description()</code> \
annotations instead.</p></ac:rich-text-body></ac:structured-macro>`

function buildStorageBody(markdown) {
  return `${GENERATED_BANNER}\n${markdownToStorage(markdown)}`
}

function requireEnv() {
  const missing = REQUIRED_ENV.filter((name) => !process.env[name])
  if (missing.length > 0) {
    console.error(
      `Missing required environment variable(s): ${missing.join(', ')}`
    )
    process.exit(1)
  }
}

async function fetchPage(baseUrl, pageId, headers) {
  const response = await fetch(
    `${baseUrl}/rest/api/content/${pageId}?expand=version`,
    { headers }
  )
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `Failed to fetch Confluence page ${pageId}: ${response.status} ${detail}`
    )
  }
  return response.json()
}

async function updatePage(baseUrl, pageId, headers, page, body) {
  const nextVersion = page.version.number + 1
  const response = await fetch(`${baseUrl}/rest/api/content/${pageId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      id: pageId,
      type: 'page',
      title: page.title,
      version: {
        number: nextVersion,
        message: 'Updated from bng-metric-backend data dictionary'
      },
      body: { storage: { value: body, representation: 'storage' } }
    })
  })
  if (!response.ok) {
    const detail = await response.text()
    throw new Error(
      `Failed to update Confluence page ${pageId}: ${response.status} ${detail}`
    )
  }
  return nextVersion
}

// Regex-free trailing-slash strip (a `/\/+$/` regex trips SonarCloud's ReDoS
// hotspot, S5852, even though this use is bounded).
function stripTrailingSlashes(value) {
  let end = value.length
  while (end > 0 && value[end - 1] === '/') {
    end -= 1
  }
  return value.slice(0, end)
}

async function main() {
  const markdown = readFileSync(MARKDOWN_PATH, 'utf8')
  const body = buildStorageBody(markdown)

  if (process.argv.includes('--dry-run')) {
    process.stdout.write(`${body}\n`)
    return
  }

  requireEnv()
  const baseUrl = stripTrailingSlashes(process.env.CONFLUENCE_BASE_URL)
  const pageId = process.env.CONFLUENCE_PAGE_ID
  const auth = Buffer.from(
    `${process.env.CONFLUENCE_USER_EMAIL}:${process.env.CONFLUENCE_API_TOKEN}`
  ).toString('base64')
  const headers = {
    Authorization: `Basic ${auth}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  }

  const page = await fetchPage(baseUrl, pageId, headers)
  await updatePage(baseUrl, pageId, headers, page, body)
  // No page ID / title / version in the log: page ID comes from env and the
  // title/version from the HTTP response, all of which SonarCloud treats as
  // untrusted (S5145). On failure, main() rejects and Node prints the error to
  // stderr and exits non-zero on its own.
  console.log('Published the data dictionary to Confluence.')
}

await main()
