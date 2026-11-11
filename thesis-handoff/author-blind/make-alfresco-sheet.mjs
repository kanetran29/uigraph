/**
 * Builds the author's blind reading sheet for the alfresco structural reference
 * (route-oracle/ground-truth/alfresco.json): one item per listed navigation site, showing the site's
 * source lines and, as candidates, all 26 screens of the application in route order with a box
 * each. The reader ticks the screens the site can fire from. Every item offers the same candidates,
 * so the list says nothing of the reference's screen set; the set, its reason and the target are
 * not written.
 *
 * Usage: node make-alfresco-sheet.mjs
 */
import { appDirs, hash, readJson, snippet, tilde, writeSheet } from './sheet-lib.mjs'

const CONTEXT = 12

/** Builds and writes alfresco-sheet.json. */
function main() {
  const dir = appDirs().alfresco
  const truth = readJson('../route-oracle/ground-truth/alfresco.json')
  const items = truth.sites.map(({ site }) => {
    const [file, line] = [site.replace(/:\d+$/, ''), Number(site.split(':').pop())]
    const lines = snippet(dir, file, line, CONTEXT)
    if (!lines) throw new Error(`no source for ${site}`)
    return {
      id: hash(`alfresco|${site}`),
      app: 'alfresco',
      file,
      line,
      claim: 'Which screens can the highlighted navigation fire from?',
      context: [`Application directory: ${tilde(dir)}`],
      lines,
    }
  })
  writeSheet('alfresco-sheet.json', {
    built: 'make-alfresco-sheet.mjs',
    title: 'alfresco navigation sites',
    intro: "Each item highlights a navigation site in alfresco (projects/aca-content at b88d47f): a routerLink, or a Router.navigate or navigateByUrl call. Tick every screen the site can fire from. A site in a component fires from the screens whose routed component renders that component, directly or through template element selectors; what the shell renders around the primary outlet is on every screen. A site in a service fires from the screens from which its enclosing method can actually be called: search for the callers, not for the components that inject the service. Screens are the 26 primary-outlet routes listed under each item; routes on the secondary 'viewer' outlet are not screens. Some components are placed by configuration (assets/app.extensions.json) or by layouts from @alfresco libraries outside the source tree. Answer 'unsure' when the source does not settle the set, and tick what you can.",
    questions: [
      { key: 'screens', text: 'Screens it can fire from:', options: truth.screens, multi: true },
      { key: 'sure', text: 'Does the source settle the ticked set?', options: ['sure', 'unsure'] },
    ],
    items,
  })
  console.log(`${items.length} items -> alfresco-sheet.json`)
}

main()
