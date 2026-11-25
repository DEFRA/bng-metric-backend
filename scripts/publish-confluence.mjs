/**
 * Publish a generated Markdown page to a Confluence Cloud page: the data
 * dictionary (data-dictionary/data-dictionary.md), or with
 * `--source template-mapping` the BNG Service template field mapping
 * (data-dictionary/template-mapping.md).
 *
 * Invoked on merge to main from .github/workflows/publish-data-dictionary.yml,
 * and from .github/workflows/publish-template-mapping.yml with
 * `--source template-mapping` (each workflow's `paths` filter means it only
 * runs when its Markdown changed).
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
 *   node scripts/publish-confluence.mjs --source template-mapping --dry-run
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { markdownToStorage } from './markdown-to-confluence.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const DATA_DICTIONARY_DIR = join(HERE, '..', 'data-dictionary')
const REPO_URL = 'https://github.com/DEFRA/bng-metric-backend'
const REQUIRED_ENV = [
  'CONFLUENCE_BASE_URL',
  'CONFLUENCE_PAGE_ID',
  'CONFLUENCE_USER_EMAIL',
  'CONFLUENCE_API_TOKEN'
]

// What each page is published from, and what to change instead of editing it.
const SOURCES = {
  'data-dictionary': {
    file: 'data-dictionary.md',
    name: 'the data dictionary',
    changeInstead:
      'Update the Drizzle schema or the Joi <code>.description()</code> annotations instead.'
  },
  'template-mapping': {
    file: 'template-mapping.md',
    name: 'the template field mapping',
    changeInstead:
      "Update the reader's column mapping or the column uses beside it instead."
  }
}
const DEFAULT_SOURCE = 'data-dictionary'

/** The source the command line names with `--source`, or the data dictionary. */
function sourceOf(argv) {
  const at = argv.indexOf('--source')
  const key = at === -1 ? DEFAULT_SOURCE : argv[at + 1]
  const source = SOURCES[key]
  if (!source) {
    console.error(
      `Unknown --source; expected one of: ${Object.keys(SOURCES).join(', ')}`
    )
    process.exit(1)
  }
  return source
}

// Confluence info panel making clear the page is machine-published and that
// manual edits will be overwritten on the next merge to main. The trailing `\`
// on each line strips the newline so the macro stays a single line.
function generatedBanner(source) {
  return `<ac:structured-macro ac:name="info"><ac:rich-text-body><p>\
Auto-generated from <a href="${REPO_URL}">bng-metric-backend</a> and republished \
on every merge to <code>main</code>. Do not edit here — changes will be \
overwritten. ${source.changeInstead}</p></ac:rich-text-body></ac:structured-macro>`
}

function buildStorageBody(markdown, source) {
  return `${generatedBanner(source)}\n${markdownToStorage(markdown)}`
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

async function updatePage(baseUrl, pageId, headers, page, body, source) {
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
        message: `Updated from bng-metric-backend ${source.name}`
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
  const source = sourceOf(process.argv)
  const markdown = readFileSync(join(DATA_DICTIONARY_DIR, source.file), 'utf8')
  const body = buildStorageBody(markdown, source)

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
  await updatePage(baseUrl, pageId, headers, page, body, source)
  // No page ID / title / version in the log: page ID comes from env and the
  // title/version from the HTTP response, all of which SonarCloud treats as
  // untrusted (S5145). On failure, main() rejects and Node prints the error to
  // stderr and exits non-zero on its own.
  console.log(`Published ${source.name} to Confluence.`)
}

await main()
