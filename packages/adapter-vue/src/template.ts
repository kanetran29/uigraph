// Extracting navigations from a component's template and its transitively-imported
// child components: <router-link> (`to`/`:to`) and custom link wrappers, plus child
// SFC navs attributed to the parent route as may-edges.

import type { Project } from 'ts-morph'
import { dirname, relative } from 'node:path'
import type { RawTarget, TargetInfo } from './types'
import { resolveVueComponent } from './project'
import { routerVars, navTargetsIn, type RouterWrappers } from './nav'
import { classifyBoundExpr, classifyBoundName } from './targets'
import { parseTemplateElements, stringAttr, boundAttr } from './sfc'
import type { VueComponent, VueProject } from './extract'

/** Whether a tag is a Vue component (PascalCase or kebab-case multi-word), i.e. a possible router-link wrapper. */
function isComponentTag(tag: string): boolean {
  return /[A-Z]/.test(tag) || tag.includes('-')
}

/** A component's imported child .vue components (default-import specifiers resolved to registered SFCs). */
function childComponents(component: VueComponent, components: VueComponent[]): VueComponent[] {
  const out: VueComponent[] = []
  for (const imp of component.scriptSf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()
    if (!imp.getDefaultImport() && imp.getNamedImports().length === 0) continue
    const child = resolveVueComponent(component.vuePath, spec, components)
    if (child && child !== component) out.push(child)
  }
  return out
}

/**
 * Collect navigations declared in a route's transitively-imported child components,
 * attributing them to the parent route. Child navs are invisible to the per-route
 * scan because they live in separate SFCs (e.g. an article page's <ArticleMeta>
 * does the `router.push({ name: 'login' })`). Visited-set bounds cycles; child
 * targets are demoted to may-edges since the child may render conditionally.
 */
export function childTargets(component: VueComponent, vp: VueProject, nameToPath: Map<string, string>, wrappers: RouterWrappers): RawTarget[] {
  const out: RawTarget[] = []
  const visited = new Set<string>([component.vuePath])
  const walk = (comp: VueComponent): void => {
    for (const child of childComponents(comp, vp.components)) {
      if (visited.has(child.vuePath)) continue
      visited.add(child.vuePath)
      const file = relative(dirname(component.vuePath), child.vuePath)
      const vars = routerVars(child.scriptSf)
      const targets = [...templateTargets(child, vp.project, nameToPath), ...navTargetsIn(child.scriptSf, child.scriptSf, vars, nameToPath, wrappers)]
      for (const t of targets) out.push({ ...t, effect: `${t.effect} (child ${file})`, guard: t.guard ?? 'child-component' })
      walk(child)
    }
  }
  walk(component)
  return out
}

/**
 * Parse routing navigations out of a component's template. Recognizes <router-link>
 * (`to`/`:to`) and custom wrapper components (e.g. <AppLink>) that forward routing
 * props via `to`/`:to`/`name`/`:name`. A `name` wrapper prop is classified through a
 * synthetic `{ name }` object so it resolves the same way as a router.push object.
 */
export function templateTargets(component: VueComponent, project: Project, nameToPath: Map<string, string>): RawTarget[] {
  const out: RawTarget[] = []
  for (const el of parseTemplateElements(component.sfc.template, component.sfc.templateOffset)) {
    const isRouterLink = /^(router-link|routerlink)$/i.test(el.tag)
    const plainTo = stringAttr(el, 'to')
    const boundTo = boundAttr(el, 'to')
    const plainName = stringAttr(el, 'name')
    const boundName = boundAttr(el, 'name')
    const hasRouting = plainTo !== undefined || boundTo !== undefined || plainName !== undefined || boundName !== undefined
    if (!isRouterLink && !(isComponentTag(el.tag) && hasRouting)) continue
    const lc = lineColAt(component.source, el.offset)
    const push = (ti: TargetInfo) => out.push({ ti, event: 'click:router-link', effect: 'navigate', ruleId: 'vue.router-link', loc: lc, guard: null })
    if (plainTo !== undefined) push({ kind: 'literal', value: plainTo })
    else if (boundTo !== undefined) push(classifyBoundExpr(boundTo, component, project, nameToPath))
    else if (plainName !== undefined) push(nameToPath.has(plainName) ? { kind: 'literal', value: nameToPath.get(plainName) as string } : { kind: 'dynamic' })
    else if (boundName !== undefined) push(classifyBoundName(boundName, component, nameToPath))
  }
  return out
}

/** Map an absolute source offset back to a 1-based line/col within the .vue file. */
function lineColAt(source: string, offset: number): { line: number; col: number } {
  let line = 1
  let col = 1
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === '\n') {
      line += 1
      col = 1
    } else {
      col += 1
    }
  }
  return { line, col }
}
