/**
 * Resolve the report's body fonts once, at startup, and hang them on
 * `server.app` for the report builder to use.
 *
 * Registered unconditionally, because unlike the OS tiles plugin this always
 * has an answer: with no bucket configured it resolves the committed Noto Sans
 * and the service behaves exactly as it did before this seam existed. A
 * configured bucket that cannot be read degrades to the same committed fonts
 * with a warning, so this never fails a boot — see `services/report/fonts.js`
 * for that trade and for the warning it turns on.
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
