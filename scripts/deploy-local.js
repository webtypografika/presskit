/**
 * deploy-local.js — Builds and deploys to the local installed PressKit
 * Usage: node scripts/deploy-local.js
 *
 * 1. Runs electron-vite build
 * 2. Creates asar with out/ + production node_modules
 * 3. Copies to C:\Program Files\PressKit\resources\app.asar
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const INSTALL_DIR = 'C:\\Program Files\\PressKit\\resources'
const BUILD_DIR = path.join(ROOT, '.asar-build')
const ASAR_OUT = path.join(ROOT, 'app-deploy.asar')

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
  if (fs.existsSync(BUILD_DIR)) fs.rmSync(BUILD_DIR, { recursive: true, force: true })
  fs.mkdirSync(path.join(BUILD_DIR, 'out'), { recursive: true })

  // Copy built output under out/ (installed app expects out/main/index.js)
  for (const dir of ['main', 'preload', 'renderer']) {
    fs.cpSync(path.join(ROOT, 'out', dir), path.join(BUILD_DIR, 'out', dir), { recursive: true })
  }
  fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(BUILD_DIR, 'package.json'))

  // Install production deps
  run('npm install --omit=dev --ignore-scripts', { cwd: BUILD_DIR })

  // 3. Pack asar
  console.log('\n=== Packing asar ===')
  const asar = require('@electron/asar')
  await asar.createPackage(BUILD_DIR, ASAR_OUT)
  const size = (fs.statSync(ASAR_OUT).size / 1024 / 1024).toFixed(1)
  console.log(`asar: ${ASAR_OUT} (${size} MB)`)

  // 4. Copy to install dir
  console.log('\n=== Deploying ===')
  try {
    fs.copyFileSync(ASAR_OUT, path.join(INSTALL_DIR, 'app.asar'))
    console.log('Deployed to', INSTALL_DIR)
  } catch (e) {
    if (e.code === 'EPERM') {
      console.log('\nPermission denied. Copy manually:')
      console.log(`  FROM: ${ASAR_OUT}`)
      console.log(`  TO:   ${path.join(INSTALL_DIR, 'app.asar')}`)
    } else {
      throw e
    }
  }

  // Cleanup
  fs.rmSync(BUILD_DIR, { recursive: true, force: true })
  console.log('\nDone!')
}

main().catch(e => { console.error(e); process.exit(1) })
