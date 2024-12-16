import { Browser, getInstalledBrowsers, install } from '@puppeteer/browsers'
import * as core from '@actions/core'

const CACHE_DIR = '/home/runner/.cache/puppeteer'

/**
 * Prepare the Puppeteer environment by installing the necessary browser.
 * @returns {Promise<void>} Resolves when the environment is prepared.
 */
export async function preparePuppeteer(): Promise<void> {
  if (process.env.RUNNER_TEMP === undefined) {
    core.info('Running locally, skipping Puppeteer setup ...')
    return
  }

  const installed = await getInstalledBrowsers({
    cacheDir: CACHE_DIR
  })

  if (!installed.some(browser => browser.browser === Browser.CHROME)) {
    core.info('Installing Chrome ...')
    await install({
      cacheDir: CACHE_DIR,
      browser: Browser.CHROME,
      buildId: '131.0.6778.108'
    })
  }
}
