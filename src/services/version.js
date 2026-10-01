/** Optional update hint: failures must not affect startup or game state. */
export async function checkVersion({ current, pageUrl, fetcher, announce, now = Date.now }) {
  try {
    if (typeof fetcher !== 'function' || !/^https?:\/\//i.test(pageUrl || '')) return false;
    const page = new URL(pageUrl);
    page.search = '';
    page.hash = '';
    const manifest = new URL('version.json', page);
    manifest.searchParams.set('_v', String(now()));
    const response = await fetcher(manifest.href, {cache:'no-store',credentials:'same-origin'});
    if (!response?.ok) return false;
    const data = await response.json();
    const remote = data?.version;
    if (typeof remote !== 'string' || !/^[0-9][\w.\-]*$/.test(remote) || remote === current) return false;
    return Boolean(announce(remote));
  } catch {
    return false;
  }
}
