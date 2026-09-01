/**
 * Resolve the report's body fonts once, at startup, and hang them on
 * `server.app` for the report builder to use.
 *
 * Registered unconditionally, because unlike the OS tiles plugin this always
 * has an answer: with no bucket configured it resolves the committed Noto Sans
 * and the service behaves exactly as it did before this seam existed. What it
 * buys is that a deployment TOLD to use a privately held typeface — GDS
 * Transport, which cannot be committed to a public repository — either has it
 * before it serves a single request, or does not start at all. See
 * `services/report/fonts.js` for why that failure belongs at boot.
 */

import { loadReportFonts } from '../services/report/fonts.js'

const reportFonts = {
  plugin: {
    name: 'report-fonts',
    register: async (server) => {
      server.app.reportFonts = await loadReportFonts()
    }
  }
}

export { reportFonts }
