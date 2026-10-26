// Loads the Akira Expanded wordmark font when it is installed on the system or added to public/fonts.
// It's a commercial font, so no file is bundled; until one is available, CSS falls back to Archivo at full
// width (see styles.css).

import { api } from './api'

export async function loadBrandFont(): Promise<void> {
  const file = await api.brandFont().catch(() => null)
  const sources = ["local('Akira Expanded')", "local('AkiraExpanded-SuperBold')", ...(file ? [`url('${file}')`] : [])]
  try {
    document.fonts.add(await new FontFace('Akira Expanded', sources.join(', '), { display: 'swap' }).load())
  } catch {
    // Not installed or provided: the Archivo fallback stays in place.
  }
}
