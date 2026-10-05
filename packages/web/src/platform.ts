/**
 * The kind of computer a page runs on, as far as livesaver cares: whether its paths have drives
 * (Windows). A browser tells a page, and a worker of the page, in its user agent.
 */
export function onWindows(): boolean {
  const browser = (globalThis as { navigator?: { userAgent?: string } }).navigator
  return /\bWindows\b/i.test(browser?.userAgent ?? '')
}
