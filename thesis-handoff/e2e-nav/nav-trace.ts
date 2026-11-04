import { Router, Event, NavigationStart, NavigationEnd, NavigationCancel, NavigationError, ActivatedRouteSnapshot } from '@angular/router';

const ENDPOINT = 'http://127.0.0.1:4599/log';

function patternOf(router: Router): string {
  const parts: string[] = [];
  let node: ActivatedRouteSnapshot | null = router.routerState.snapshot.root;
  while (node) {
    const p = node.routeConfig?.path;
    if (p) parts.push(p);
    node = node.firstChild;
  }
  return '/' + parts.join('/');
}

export function startNavTrace(router: Router): void {
  let prev: { url: string; pattern: string } | null = null;
  let current: { id: number; trigger: string | null; replaceUrl: boolean | undefined; skipLocationChange: boolean | undefined } | null = null;

  const post = (rec: Record<string, unknown>) =>
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(rec),
      keepalive: true,
    }).catch(() => {});

  router.events.subscribe((e: Event) => {
    const testTitle = (window as any).__testTitle ?? null;
    if (e instanceof NavigationStart) {
      const extras = router.getCurrentNavigation()?.extras;
      current = {
        id: e.id,
        trigger: e.navigationTrigger ?? null,
        replaceUrl: extras?.replaceUrl,
        skipLocationChange: extras?.skipLocationChange,
      };
      post({ type: 'NavigationStart', id: e.id, url: e.url, trigger: e.navigationTrigger ?? null, replaceUrl: extras?.replaceUrl ?? null, skipLocationChange: extras?.skipLocationChange ?? null, ts: Date.now(), testTitle });
    } else if (e instanceof NavigationEnd) {
      const pattern = patternOf(router);
      post({
        type: 'NavigationEnd',
        id: e.id,
        url: e.url,
        urlAfterRedirects: e.urlAfterRedirects,
        trigger: current?.trigger ?? null,
        replaceUrl: current?.replaceUrl ?? null,
        skipLocationChange: current?.skipLocationChange ?? null,
        fromUrl: prev?.url ?? null,
        fromPattern: prev?.pattern ?? null,
        pattern,
        ts: Date.now(),
        testTitle,
      });
      prev = { url: e.urlAfterRedirects, pattern };
    } else if (e instanceof NavigationCancel) {
      post({ type: 'NavigationCancel', id: e.id, url: e.url, code: e.code, reason: e.reason, trigger: current?.trigger ?? null, ts: Date.now(), testTitle });
    } else if (e instanceof NavigationError) {
      post({ type: 'NavigationError', id: e.id, url: e.url, error: String(e.error), trigger: current?.trigger ?? null, ts: Date.now(), testTitle });
    }
  });
}
