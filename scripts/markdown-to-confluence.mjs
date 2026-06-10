/**
 * Convert the generated data dictionary Markdown to Confluence storage format
 * (the XHTML dialect Confluence persists pages in).
 *
 * This is intentionally a *small* converter, not a general-purpose Markdown
 * engine: it handles only the constructs `scripts/gen-data-dictionary.js`
 * emits — headings, blockquotes, paragraphs, GitHub-Flavoured tables, unordered
 * lists, and inline code / links / bold. Keeping the surface area tiny keeps the
 * output predictable and easy to test.
 */

const HEADING_RE = /^(#{1,6})\s+(.*)$/
const LIST_ITEM_RE = /^[-*]\s+(.*)$/
const SEPARATOR_CELL_RE = /^:?-+:?$/

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('"', '&quot;')
}

// Split a table row on unescaped pipes, honouring the `\|` escape the generator
// uses for literal pipes inside a cell, then drop the empty leading/trailing
// cells produced by the surrounding pipes.
function splitTableRow(line) {
  const cells = []
  let current = ''
  for (let i = 0; i < line.length; i++) {
    const char = line[i]
    if (char === '\\' && line[i + 1] === '|') {
      current += '|'
      i++
    } else if (char === '|') {
      cells.push(current)
      current = ''
    } else {
      current += char
    }
  }
  cells.push(current)
  return cells.slice(1, -1).map((cell) => cell.trim())
}

function isSeparatorRow(line) {
  const trimmed = line.trim()
  if (!trimmed.startsWith('|')) {
    return false
  }
  const cells = splitTableRow(trimmed)
  return cells.length > 0 && cells.every((cell) => SEPARATOR_CELL_RE.test(cell))
}

function isTableStart(lines, index) {
  if (!lines[index].trim().startsWith('|')) {
    return false
  }
  return index + 1 < lines.length && isSeparatorRow(lines[index + 1])
}

function matchLink(text, start) {
  const close = text.indexOf(']', start + 1)
  if (close === -1 || text[close + 1] !== '(') {
    return null
  }
  const urlEnd = text.indexOf(')', close + 2)
  if (urlEnd === -1) {
    return null
  }
  return {
    label: text.slice(start + 1, close),
    url: text.slice(close + 2, urlEnd),
    next: urlEnd + 1
  }
}

function renderCodeSpan(text, start) {
  const end = text.indexOf('`', start + 1)
  if (end === -1) {
    return null
  }
  return {
    html: `<code>${escapeHtml(text.slice(start + 1, end))}</code>`,
    next: end + 1
  }
}

// Inline rendering: code spans, links and bold, with HTML-escaped literal text.
// Code spans are matched first so backticks inside a link label or bold run are
// treated as code. `renderInline` recurses on link labels and bold runs to keep
// nesting working.
function renderInline(text) {
  let out = ''
  let i = 0
  while (i < text.length) {
    const char = text[i]
    let token = null
    if (char === '`') {
      token = renderCodeSpan(text, i)
    } else if (char === '[') {
      const link = matchLink(text, i)
      if (link) {
        token = {
          html: `<a href="${escapeAttribute(link.url)}">${renderInline(link.label)}</a>`,
          next: link.next
        }
      }
    } else if (char === '*' && text[i + 1] === '*') {
      const end = text.indexOf('**', i + 2)
      if (end !== -1) {
        token = {
          html: `<strong>${renderInline(text.slice(i + 2, end))}</strong>`,
          next: end + 2
        }
      }
    }
    if (token) {
      out += token.html
      i = token.next
    } else {
      out += escapeHtml(char)
      i++
    }
  }
  return out
}

function renderHeading(match) {
  const level = match[1].length
  return `<h${level}>${renderInline(match[2].trim())}</h${level}>`
}

function consumeBlockquote(lines, start) {
  const quote = []
  let i = start
  while (i < lines.length && lines[i].startsWith('>')) {
    quote.push(lines[i].replace(/^>\s?/, ''))
    i++
  }
  return {
    html: `<blockquote><p>${renderInline(quote.join(' '))}</p></blockquote>`,
    next: i
  }
}

function consumeTable(lines, start) {
  const header = splitTableRow(lines[start].trim())
  let i = start + 2
  const bodyRows = []
  while (i < lines.length && lines[i].trim().startsWith('|')) {
    bodyRows.push(splitTableRow(lines[i].trim()))
    i++
  }
  const headHtml = header
    .map((cell) => `<th>${renderInline(cell)}</th>`)
    .join('')
  const bodyHtml = bodyRows
    .map(
      (row) =>
        `<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`
    )
    .join('')
  return {
    html: `<table><tbody><tr>${headHtml}</tr>${bodyHtml}</tbody></table>`,
    next: i
  }
}

function consumeList(lines, start) {
  const items = []
  let current = null
  let i = start
  while (i < lines.length && lines[i].trim() !== '') {
    const itemMatch = LIST_ITEM_RE.exec(lines[i])
    if (itemMatch) {
      if (current !== null) {
        items.push(current)
      }
      current = itemMatch[1].trim()
    } else if (/^\s+\S/.test(lines[i])) {
      current = `${current} ${lines[i].trim()}`
    } else {
      break
    }
    i++
  }
  if (current !== null) {
    items.push(current)
  }
  const itemsHtml = items
    .map((item) => `<li>${renderInline(item)}</li>`)
    .join('')
  return { html: `<ul>${itemsHtml}</ul>`, next: i }
}

function isParagraphLine(lines, index) {
  const line = lines[index]
  return (
    line.trim() !== '' &&
    !HEADING_RE.test(line) &&
    !line.startsWith('>') &&
    !LIST_ITEM_RE.test(line) &&
    !isTableStart(lines, index)
  )
}

function consumeParagraph(lines, start) {
  const paragraph = []
  let i = start
  while (i < lines.length && isParagraphLine(lines, i)) {
    paragraph.push(lines[i].trim())
    i++
  }
  return { html: `<p>${renderInline(paragraph.join(' '))}</p>`, next: i }
}

function consumeBlock(lines, index) {
  const line = lines[index]
  const heading = HEADING_RE.exec(line)
  if (heading) {
    return { html: renderHeading(heading), next: index + 1 }
  }
  if (line.startsWith('>')) {
    return consumeBlockquote(lines, index)
  }
  if (isTableStart(lines, index)) {
    return consumeTable(lines, index)
  }
  if (LIST_ITEM_RE.test(line)) {
    return consumeList(lines, index)
  }
  return consumeParagraph(lines, index)
}

export function markdownToStorage(markdown) {
  const lines = markdown.replaceAll('\r\n', '\n').split('\n')
  const blocks = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i++
      continue
    }
    const block = consumeBlock(lines, i)
    blocks.push(block.html)
    i = block.next
  }
  return blocks.join('\n')
}
