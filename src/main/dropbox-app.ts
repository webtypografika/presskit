/**
 * The Dropbox application PressKit connects through.
 *
 * It belongs to PressCal, not to the customer. A printer asked for a «Dropbox
 * App Client ID» has no way of knowing what that is or where to find it — and
 * should never have been asked: creating a Dropbox developer app is our job,
 * done once, not theirs, done never.
 *
 * Shipping this key in the app is correct, not a leak. It is an app KEY, not an
 * app SECRET, and the flow uses PKCE (see dropbox-client.ts), which exists
 * precisely so that public clients — desktop and mobile apps that cannot keep a
 * secret — can authenticate safely. There is no secret anywhere in PressKit.
 *
 * Scopes this app needs, and nothing more:
 *   account_info.read    — to show who is connected
 *   files.metadata.read  — listing folders, reading revisions
 *   files.content.read   — downloading a file
 *   files.content.write  — uploading a file
 *
 * Redirect URI to whitelist in the app's OAuth settings:
 *   http://localhost:17823/callback
 *
 * ⚠️ A Dropbox app starts in Development mode and can link at most 50 accounts.
 * That is ample while PressKit is used in one shop; before it ships widely the
 * app has to be submitted for Production approval, which Dropbox reviews.
 */
export const DROPBOX_APP_KEY = ''

/** Has the build been given an app key? */
export const hasBundledDropboxApp = (): boolean => DROPBOX_APP_KEY.trim().length > 0
