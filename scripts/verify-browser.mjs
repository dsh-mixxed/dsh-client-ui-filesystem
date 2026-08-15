/**
 * Browser verification for the ui-filesystem '@' source on a real instance.
 * Drives the system Chrome headless against http://127.0.0.1:3800 (the
 * fs-dev profile instance): opens the GUI, selects the deepseek-harness
 * workspace, types '@' into the composer, waits for the trigger menu,
 * filters by basename prefix, picks the highlighted entry, and asserts the
 * draft carries the exact plain-text reference for that entry's path.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const URL = process.env.DSH_FS_URL ?? 'http://127.0.0.1:3800'
const SHOT_DIR = process.env.DSH_FS_SHOTS ?? ''
const WORKSPACE = process.env.DSH_FS_WORKSPACE ?? 'deepseek-harness'
if (SHOT_DIR) mkdirSync(SHOT_DIR, { recursive: true })

async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
  page.on('pageerror', error => console.log('[pageerror]', String(error).slice(0, 400)))
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('[console.error]', msg.text().slice(0, 400))
  })
  // The tree request reveals the session id the client addresses.
  let sessionId = null
  page.on('request', request => {
    const match = /\/plugin\/ui-filesystem\/tree\?sessionId=([^&]+)/.exec(request.url())
    if (match !== null) sessionId = decodeURIComponent(match[1])
  })

  await page.goto(URL, { waitUntil: 'domcontentloaded' })
  const textarea = page.locator('textarea').first()
  await textarea.waitFor({ state: 'visible', timeout: 90000 })
  console.log('composer visible')

  // The GUI opens in the workspace-picker state; select the workspace row.
  const workspaceRow = page.locator('[role="treeitem"]', { hasText: WORKSPACE }).first()
  await workspaceRow.waitFor({ state: 'visible', timeout: 30000 })
  await workspaceRow.click()
  console.log('workspace selected:', WORKSPACE)

  // The composer activates once a session scope is live: poll until typing sticks.
  let typed = false
  for (let attempt = 0; attempt < 20 && !typed; attempt += 1) {
    await page.waitForTimeout(500)
    await textarea.click()
    await page.keyboard.type('@')
    await page.waitForTimeout(300)
    const value = await textarea.inputValue()
    typed = value === '@'
    if (!typed) await page.keyboard.press('Control+a')
  }
  if (!typed) throw new Error('composer never accepted the "@" keystroke')
  console.log('@ accepted into the draft')

  const listbox = page.locator('[role="listbox"]')
  await listbox.waitFor({ state: 'visible', timeout: 15000 })
  console.log('menu open')
  const groupTitles = await page.locator('[role="listbox"] [role="presentation"]').allTextContents()
  console.log('group titles:', JSON.stringify(groupTitles))
  if (!groupTitles.includes('filesystem')) {
    throw new Error(`expected a "filesystem" group, got ${JSON.stringify(groupTitles)}`)
  }

  // Filter by basename prefix ('in'): wait for the group to settle with items.
  await page.keyboard.type('in')
  const options = page.locator('[role="listbox"] [role="option"]')
  await options.first().waitFor({ state: 'visible', timeout: 20000 })
  const items = await options.allTextContents()
  console.log(`candidates for "in" (${items.length}):`, JSON.stringify(items.slice(0, 6)))
  if (SHOT_DIR) {
    await page.screenshot({ path: `${SHOT_DIR}/01-menu-filtered.png` })
  }

  // Compute the expected candidate list from the tree API (the client filters
  // the settled snapshot by basename prefix, case-insensitive, capped at 50).
  if (sessionId === null) throw new Error('no tree request observed for the session')
  const treeResponse = await fetch(`${URL}/plugin/ui-filesystem/tree?sessionId=${encodeURIComponent(sessionId)}`)
  const tree = await treeResponse.json()
  if (!treeResponse.ok || !('entries' in tree)) {
    throw new Error(`tree API failed: ${JSON.stringify(tree)}`)
  }
  const expected = [...tree.entries]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .filter(entry => entry.name.toLowerCase().startsWith('in'))
    .slice(0, 50)
    .map(entry => entry.path)
  // Each option row renders name + path as two adjacent spans: its text
  // content is exactly `basename(path) + path` with no separator.
  if (items.length !== expected.length) {
    throw new Error(`menu shows ${items.length} candidates, API filter yields ${expected.length}`)
  }
  for (let index = 0; index < expected.length; index += 1) {
    const path = expected[index]
    const wanted = `${path.split('/').at(-1)}${path}`
    if (items[index] !== wanted) {
      throw new Error(`candidate ${index} mismatch: got ${JSON.stringify(items[index])}, want ${JSON.stringify(wanted)}`)
    }
  }

  // Pick the highlighted entry (Enter): the draft must carry '@<path> '.
  await page.keyboard.press('Enter')
  await page.waitForTimeout(400)
  const draft = await textarea.inputValue()
  console.log('draft after pick:', JSON.stringify(draft))
  const firstPath = expected[0]
  const wanted = `@${firstPath} `
  if (draft !== wanted) {
    throw new Error(`expected draft ${JSON.stringify(wanted)}, got ${JSON.stringify(draft)}`)
  }
  if (SHOT_DIR) {
    await page.screenshot({ path: `${SHOT_DIR}/02-picked.png` })
  }

  await browser.close()
  console.log('VERIFY OK')
}

main().catch(error => {
  console.error('VERIFY FAILED:', error)
  process.exit(1)
})
