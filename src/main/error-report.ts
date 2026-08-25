import { IpcMain, app } from 'electron'
import { hostname, release, type as osType } from 'os'

/**
 * "Send a report to the developers" — the reports land in PressCal's support
 * queue (/admin/support) next to in-app messages, so there is one place to read.
 *
 * Two rules, both from George (2026-08-25):
 *  - Nothing is sent unless the user presses the button.
 *  - The user sees the exact text first. A report carries file paths, and file
 *    paths carry customer names, so "we collect some diagnostics" is not good
 *    enough — they read the actual lines.
 *
 * That is why compose() and send() are split: the renderer shows what compose()
 * returned, and send() transmits that same string. The preview cannot drift
 * from what goes out, because it IS what goes out.
 */

export type ReportContext = {
  /** What the user was doing: "Delete files", "Convert", … */
  operation: string
  /** One line per error, already human-readable. */
  errors?: string[]
  /** Paths involved. Shown in the preview so the user can see what they reveal. */
  paths?: string[]
  /** Anything else worth sending, as label → value. */
  extra?: Record<string, string | number | undefined>
}

export function composeReport(ctx: ReportContext): string {
  const lines: string[] = []
  lines.push(`Operation : ${ctx.operation}`)
  lines.push(`PressKit  : ${app.getVersion()}`)
  lines.push(`System    : ${osType()} ${release()} (${process.platform} ${process.arch})`)
  lines.push(`Machine   : ${hostname()}`)
  lines.push(`When      : ${new Date().toISOString()}`)

  for (const [k, v] of Object.entries(ctx.extra ?? {})) {
    if (v !== undefined && v !== '') lines.push(`${k.padEnd(10)}: ${v}`)
  }

  if (ctx.errors?.length) {
    lines.push('', 'Errors:')
    for (const e of ctx.errors) lines.push(`  ${e}`)
  }

  if (ctx.paths?.length) {
    lines.push('', 'Paths involved:')
    // Capped: a failed multi-select can be hundreds of files, and nobody needs
    // to scroll through them to decide whether to send.
    for (const p of ctx.paths.slice(0, 20)) lines.push(`  ${p}`)
    if (ctx.paths.length > 20) lines.push(`  … and ${ctx.paths.length - 20} more`)
  }

  return lines.join('\n')
}

export function registerErrorReportHandlers(
  ipcMain: IpcMain,
  postToPresscal: (endpoint: string, body: unknown) => Promise<unknown>,
): void {
  ipcMain.handle('report:compose', (_e, ctx: ReportContext) => composeReport(ctx))

  // Sends verbatim what it is given — the string the user just read.
  ipcMain.handle('report:send', async (_e, text: string, subject?: string) => {
    try {
      await postToPresscal('/report', {
        subject: subject || 'PressKit report',
        message: text,
        appVersion: app.getVersion(),
        platform: `${osType()} ${release()} (${process.platform} ${process.arch})`,
      })
      return { ok: true }
    } catch (err: any) {
      // Reported back rather than swallowed: "sent!" when nothing was sent is
      // worse than an honest failure, and PressCal may simply not be linked yet.
      return { ok: false, error: err?.message || String(err) }
    }
  })
}
