// Component template reading for the Angular adapter: pull a component's template
// text from an inline `@Component({ template })` string or an external
// `templateUrl` sibling, carrying the witness position (a `.ts` offset for inline
// templates, or the html file path for external ones).

import { Node } from 'ts-morph'
import type { SourceFile } from 'ts-morph'
import { dirname, join } from 'node:path'
import { stringProp } from './resolve'

/** A component's template text, with the witness position: an offset into `sf`, or an external HTML file path. */
export interface ComponentTemplate {
  text: string
  start: number
  externalFile?: string
}

/**
 * Read a component's template, from an inline `@Component({ template })` string
 * or, failing that, an external `templateUrl: './x.html'` sibling resolved
 * relative to the component file. Inline templates carry their `.ts` offset;
 * external ones carry the html file path so witnesses point at the real source.
 */
export function inlineTemplate(sf: SourceFile): ComponentTemplate | null {
  for (const cls of sf.getClasses()) {
    for (const dec of cls.getDecorators()) {
      if (dec.getName() !== 'Component') continue
      const arg = dec.getArguments()[0]
      if (!arg || !Node.isObjectLiteralExpression(arg)) continue
      const inline = stringProp(arg, 'template')
      if (inline !== null) {
        const prop = arg.getProperty('template')
        const init = Node.isPropertyAssignment(prop) ? prop.getInitializer() : undefined
        return { text: inline, start: init ? init.getStart() : arg.getStart() }
      }
      const url = stringProp(arg, 'templateUrl')
      if (url !== null) {
        const html = readExternalTemplate(sf, url)
        if (html !== null) return { text: html, start: 0, externalFile: resolveTemplatePath(sf, url) }
      }
    }
  }
  return null
}

/** Resolve a templateUrl relative to the component file into an absolute path. */
export function resolveTemplatePath(sf: SourceFile, url: string): string {
  return join(dirname(sf.getFilePath()), url)
}

/**
 * Read an external HTML template's contents, preferring a source file already
 * registered at that path (covers in-memory projects) and falling back to the
 * project filesystem (covers on-disk projects). Returns null when unavailable.
 */
export function readExternalTemplate(sf: SourceFile, url: string): string | null {
  const path = resolveTemplatePath(sf, url)
  const project = sf.getProject()
  const registered = project.getSourceFile(path)
  if (registered) return registered.getFullText()
  const fs = project.getFileSystem()
  try {
    if (!fs.fileExistsSync(path)) return null
    return fs.readFileSync(path)
  } catch {
    return null
  }
}
