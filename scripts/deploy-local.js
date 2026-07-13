/**
 * deploy-local.js — Builds and deploys to the local installed PressKit
 * Usage: node scripts/deploy-local.js
 *
 * 1. Runs electron-vite build
 * 2. Creates asar with out/ + production node_modules
 *    (native modules like sharp are unpacked alongside the asar)
 * 3. Copies to C:\Program Files\PressKit\resources\app.asar
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const INSTALL_DIR = 'C:\\Program Files\\PressKit\\resources'
const BUILD_DIR = path.join(ROOT, '.asar-build')
const ASAR_OUT = path.join(ROOT, 'app-deploy.asar')
const ASAR_UNPACKED = ASAR_OUT + '.unpacked'

function run(cmd, opts = {}) {
  console.log(`> ${cmd}`)
  execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...opts })
}

async function main() {
  // 1. Build
  console.log('\n=== Building ===')
  run('npx electron-vite build')

  // 2. Prepare asar contents
  console.log('\n=== Preparing asar ===')
  if (fs.existsSync(BUILD_DIR)) {
    try { fs.rmSync(BUILD_DIR, { recursive: true, force: true }) } catch {
      // Dropbox lock — rename instead
      const fallback = BUILD_DIR + '-old-' + Date.now()
      try { fs.renameSync(BUILD_DIR, fallback) } catch { /* ignore */ }
    }
  }
  fs.mkdirSync(path.join(BUILD_DIR, 'out'), { recursive: true })

  // Copy built output under out/ (installed app expects out/main/index.js)
  for (const dir of ['main', 'preload', 'renderer']) {
    fs.cpSync(path.join(ROOT, 'out', dir), path.join(BUILD_DIR, 'out', dir), { recursive: true })
  }
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(BUILD_DIR, 'package.json'))

  // Install production deps
  run('npm install --omit=dev --ignore-scripts', { cwd: BUILD_DIR })

  // 3. Pack asar — unpack native modules so they can be dlopen'd
  console.log('\n=== Packing asar ===')
  const asar = require('@electron/asar')
  if (fs.existsSync(ASAR_UNPACKED)) {
    fs.rmSync(ASAR_UNPACKED, { recursive: true, force: true })
  }
  await asar.createPackageWithOptions(BUILD_DIR, ASAR_OUT, {
    unpackDir: '{node_modules/sharp,node_modules/@img,node_modules/better-sqlite3}'
  })
  const size = (fs.statSync(ASAR_OUT).size / 1024 / 1024).toFixed(1)
  console.log(`asar: ${ASAR_OUT} (${size} MB)`)
  if (fs.existsSync(ASAR_UNPACKED)) {
    console.log(`unpacked: ${ASAR_UNPACKED}`)
  }

  // 4. Copy to install dir (auto-elevate if needed)
  console.log('\n=== Deploying ===')
  const dest = path.join(INSTALL_DIR, 'app.asar')
  const destUnpacked = path.join(INSTALL_DIR, 'app.asar.unpacked')

  // Build the PowerShell commands for both asar and unpacked dir
  const copyCommands = [
    `Copy-Item -LiteralPath "${ASAR_OUT}" -Destination "${dest}" -Force`
  ]
  if (fs.existsSync(ASAR_UNPACKED)) {
    copyCommands.push(
      `if (Test-Path "${destUnpacked}") { Remove-Item -LiteralPath "${destUnpacked}" -Recurse -Force }`,
      `Copy-Item -LiteralPath "${ASAR_UNPACKED}" -Destination "${destUnpacked}" -Recurse -Force`
    )
  }

  try {
    fs.copyFileSync(ASAR_OUT, dest)
    if (fs.existsSync(ASAR_UNPACKED)) {
      if (fs.existsSync(destUnpacked)) fs.rmSync(destUnpacked, { recursive: true, force: true })
      fs.cpSync(ASAR_UNPACKED, destUnpacked, { recursive: true })
    }
    console.log('Deployed to', INSTALL_DIR)
  } catch (e) {
    if (e.code === 'EPERM' || e.code === 'EACCES') {
      console.log('Elevating to admin for copy...')
      const tmpPs1 = path.join(require('os').tmpdir(), 'presskit-deploy.ps1')
      fs.writeFileSync(tmpPs1, copyCommands.join('\n'))
      execSync(
        `powershell -NoProfile -Command "Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','${tmpPs1}'"`,
        { stdio: 'inherit' }
      )
      try { fs.unlinkSync(tmpPs1) } catch {}
      console.log('Deployed to', INSTALL_DIR)
    } else {
      throw e
    }
  }

  // Cleanup
  try { fs.rmSync(BUILD_DIR, { recursive: true, force: true }) } catch { /* Dropbox lock — ignore */ }
  console.log('\nDone!')
}

main().catch(e => { console.error(e); process.exit(1) })
