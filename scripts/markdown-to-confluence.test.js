import { describe, expect, it } from 'vitest'

import { markdownToStorage } from './markdown-to-confluence.mjs'

describe('markdownToStorage', () => {
  it('renders ATX headings at the right level', () => {
    expect(markdownToStorage('# Data dictionary')).toBe(
      '<h1>Data dictionary</h1>'
    )
    expect(markdownToStorage('### `bng.projects`')).toBe(
      '<h3><code>bng.projects</code></h3>'
    )
  })

  it('renders a multi-line blockquote as one paragraph', () => {
    const md = '> line one\n> line two'
    expect(markdownToStorage(md)).toBe(
      '<blockquote><p>line one line two</p></blockquote>'
    )
  })

  it('renders inline code, links and bold (with nested code)', () => {
    expect(markdownToStorage('See [`a/b.js`](https://x/b.js) now')).toBe(
      '<p>See <a href="https://x/b.js"><code>a/b.js</code></a> now</p>'
    )
    expect(markdownToStorage('- **`x` open maps** hold data')).toBe(
      '<ul><li><strong><code>x</code> open maps</strong> hold data</li></ul>'
    )
  })

  it('renders a GFM table with header cells and body cells', () => {
    const md = [
      '| Field | Type |',
      '| --- | --- |',
      '| `name` | `string` |'
    ].join('\n')
    expect(markdownToStorage(md)).toBe(
      '<table><tbody>' +
        '<tr><th>Field</th><th>Type</th></tr>' +
        '<tr><td><code>name</code></td><td><code>string</code></td></tr>' +
        '</tbody></table>'
    )
  })

  it('HTML-escapes angle brackets inside code spans (e.g. array<object>)', () => {
    expect(markdownToStorage('| `array<object>` |\n| --- |\n| x |')).toContain(
      '<th><code>array&lt;object&gt;</code></th>'
    )
  })

  it('treats an escaped pipe inside a cell as literal, not a separator', () => {
    const md = ['| Constraints |', '| --- |', String.raw`| a \| b |`].join('\n')
    expect(markdownToStorage(md)).toBe(
      '<table><tbody><tr><th>Constraints</th></tr><tr><td>a | b</td></tr></tbody></table>'
    )
  })

  it('renders a foreign-key reference cell with code formatting', () => {
    const md = ['| Key |', '| --- |', '| FK → `projects.id` |'].join('\n')
    expect(markdownToStorage(md)).toContain(
      '<td>FK → <code>projects.id</code></td>'
    )
  })

  it('joins indented continuation lines into the same list item', () => {
    const md = '- first line\n  second line'
    expect(markdownToStorage(md)).toBe(
      '<ul><li>first line second line</li></ul>'
    )
  })
})
