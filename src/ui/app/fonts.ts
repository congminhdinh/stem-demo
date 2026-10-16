// The UI font, Be Vietnam Pro (SIL OFL 1.1), self-hosted from @fontsource: bundled by Vite and served from the
// lab's own origin, so nothing comes from a CDN or from the page that embeds the lab (N6a S5). Every subset is
// declared (latin, latin-ext, vietnamese); the browser fetches only those a page needs.
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';

/** How long startup waits for the font: the editor measures block text once, so it should not measure a fallback. */
const fontWaitMs = 1500;

/** Resolves once the weights the UI uses are loaded, or after `fontWaitMs`; never fails (a missing font is a fallback, not an error). */
export async function loadUiFont(fonts: Pick<FontFaceSet, 'load'> | undefined = globalThis.document?.fonts, waitMs = fontWaitMs): Promise<void> {
  if (!fonts) {
    return;
  }
  const loaded = Promise.all(['400', '600', '700'].map((weight) => fonts.load(`${weight} 16px "Be Vietnam Pro"`, 'Tiếng Việt'))).then(
    () => undefined,
    () => undefined,
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, waitMs);
  });
  await Promise.race([loaded, waited]);
  clearTimeout(timer);
}
