// N17 B6 (Review Focus 4): a check stops being trusted the moment its page is hidden (another tab, a minimised window): the browser
// then runs the page's timers about once a second, so the check's presses and its goals' moments no longer line up. The lab ends
// such a check as interrupted (not passed, check again) the moment it is told.

/** Calls `onHidden` when `page` is or becomes hidden, until the returned function is called. */
export function onPageHidden(page: Document, onHidden: () => void): () => void {
  const listener = () => {
    if (page.visibilityState === 'hidden') {
      onHidden();
    }
  };
  page.addEventListener('visibilitychange', listener);
  listener();
  return () => page.removeEventListener('visibilitychange', listener);
}
