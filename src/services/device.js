// Presentation capability only; no game state or stored preferences.
export function deviceProfile(environment = globalThis) {
  const ua=environment.navigator?.userAgent || '';
  const android=!!environment.__androidTTS || (/Android/i.test(ua) && /\bwv\b/.test(ua));
  const mobile=android || /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  let desktop=!mobile;
  try { if(typeof environment.matchMedia==='function') desktop=desktop && environment.matchMedia('(min-width:768px) and (hover:hover) and (pointer:fine)').matches; } catch {}
  return {android,desktop};
}
export function applyDevicePresentation(doc = globalThis.document, environment = globalThis) {
  const profile=deviceProfile(environment);
  doc?.body?.classList.toggle('device-touch',!profile.desktop);
  doc?.body?.classList.toggle('device-android',profile.android);
  const download=doc?.getElementById('dlAndroid');
  if(download?.parentElement) download.parentElement.hidden=profile.android;
  return profile;
}
