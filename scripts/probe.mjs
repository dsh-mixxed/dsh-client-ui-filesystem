/**
 * Network probe: captures every /plugin/ui-filesystem response (status +
 * body) while typing '@' and 'in' into the composer.
 */
import { chromium } from 'playwright-core'

const URL = process.env.DSH_FS_URL ?? 'http://127.0.0.1:3800'

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
})
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } })
page.on('pageerror', error => console.log('[pageerror]', String(error).slice(0, 500)))
page.on('console', msg => {
  if (msg.type() === 'error' || msg.type() === 'warning') console.log(`[console.${msg.type()}]`, msg.text().slice(0, 500))
})
page.on('response', async response => {
  const url = response.url()
  if (!url.includes('/plugin/ui-filesystem/')) return
  const body = await response.text().catch(() => '<no body>')
  console.log(`[tree response] ${response.status()} ${url} => ${body.slice(0, 600)}`)
})
page.on('requestfailed', request => {
  if (request.url().includes('/plugin/ui-filesystem/')) {
    console.log('[tree request failed]', request.url(), request.failure()?.errorText)
  }
})

await page.goto(URL, { waitUntil: 'domcontentloaded' })
const textarea = page.locator('textarea').first()
await textarea.waitFor({ state: 'visible', timeout: 90000 })

const workspaceRow = page.locator('[role="treeitem"]', { hasText: 'deepseek-harness' }).first()
await workspaceRow.waitFor({ state: 'visible', timeout: 30000 })
await workspaceRow.click()
await page.waitForTimeout(1500)

let typed = false
for (let attempt = 0; attempt < 20 && !typed; attempt += 1) {
  await page.waitForTimeout(500)
  await textarea.click()
  await page.keyboard.type('@')
  await page.waitForTimeout(400)
  const value = await textarea.inputValue()
  typed = value === '@'
  if (!typed) await page.keyboard.press('Control+a')
}
console.log('typed @:', typed, 'value:', JSON.stringify(await textarea.inputValue()))
await page.waitForTimeout(2000)
console.log('menu after 2s:', await page.locator('[role="listbox"]').count())
await page.keyboard.type('in')
await page.waitForTimeout(2500)
console.log('menu after typing in:', await page.locator('[role="listbox"]').count())
console.log('items:', JSON.stringify(await page.locator('[role="listbox"] [role="option"]').allTextContents()))

await browser.close()
