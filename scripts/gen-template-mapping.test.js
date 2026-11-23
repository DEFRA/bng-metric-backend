import { describe, expect, it } from 'vitest'

import {
  generateTemplateMapping,
  renderJson,
  renderMarkdown
} from './gen-template-mapping.js'

describe('template field mapping generator', () => {
  it('writes the same bytes when run twice', () => {
    const first = generateTemplateMapping()
    const second = generateTemplateMapping()

    expect(renderMarkdown(second)).toBe(renderMarkdown(first))
    expect(JSON.stringify(renderJson(second))).toBe(
      JSON.stringify(renderJson(first))
    )
  })

  it('gives each template table its own section, and links the data dictionary', () => {
    const markdown = renderMarkdown(generateTemplateMapping())

    expect(markdown).toContain('### Area Habitats Baseline')
    expect(markdown).toContain('### Individual Trees Post-Intervention')
    expect(markdown).toContain('data-dictionary/data-dictionary.md')
  })

  it('records the template version it maps', () => {
    expect(renderJson(generateTemplateMapping()).template).toEqual({
      name: 'bng-service',
      version: '1.0'
    })
  })
})
