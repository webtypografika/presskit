/**
 * Just enough of `adm-zip` to type the one call this app makes.
 *
 * The package ships no types and there is no `@types/adm-zip` in the tree, so
 * `import('adm-zip')` was an implicit `any` — which is the single remaining
 * complaint once this project started type-checking at all (see
 * tsconfig.node.json for why it had not been).
 *
 * ⚠️ DELIBERATELY NARROW. `extractZipRobust` uses exactly one constructor and one
 * method, and adm-zip is the FIRST of four extraction attempts there — it is
 * expected to fail on some streamed zips and the next method takes over. A fuller
 * declaration would be a surface nobody calls, kept in step by nobody. If another
 * method is ever needed, add that one line.
 */
declare module 'adm-zip' {
  class AdmZip {
    constructor(zipPath?: string)
    /** `overwrite` as the second argument, which is how this app calls it. */
    extractAllTo(targetPath: string, overwrite?: boolean): void
  }
  export default AdmZip
}
