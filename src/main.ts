import * as core from '@actions/core'
import puppeteer from 'puppeteer'
import FormData from 'form-data'
import axios from 'axios'

import { createReadStream, statSync } from 'fs'
import { preparePuppeteer } from './utils'
import { basename } from 'path'

const SSO_URL = 'https://portal-api.cfx.re/v1/auth/discourse?return='

interface ReUploadResponse {
  asset_id: number
  errors: null
}

interface SSOResponseBody {
  url: string
}

/**
 * The main function for the action.
 * @returns {Promise<void>} Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  await preparePuppeteer()

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  })

  const page = await browser.newPage()

  try {
    const assetId = core.getInput('assetId')
    const zipPath = core.getInput('zipPath')
    const chunkSize = parseInt(core.getInput('chunkSize'))

    if (isNaN(chunkSize)) {
      core.setFailed('Invalid chunk size. Must be a number.')
      return
    }

    core.info('Navigating to SSO URL ...')

    await page.goto(SSO_URL, {
      waitUntil: 'networkidle0'
    })

    core.info('Navigated to SSO URL. Parsing response body ...')

    const responseBody = await page.evaluate(
      () => JSON.parse(document.body.innerText) as SSOResponseBody
    )

    core.debug('Parsed response body.')

    const redirectUrl = responseBody.url

    core.info('Redirected to Forum Origin ...')

    const forumUrl = new URL(redirectUrl).origin
    await page.goto(forumUrl)

    core.info('Setting cookies ...')

    await browser.setCookie({
      name: '_t',
      value: core.getInput('cookie'),
      domain: 'forum.cfx.re',
      path: '/',
      expires: -1,
      size: 1,
      httpOnly: true,
      secure: true,
      session: false
    })

    await page.evaluate(() => document.write('Cookie' + document.cookie))

    core.info('Cookies set. Following redirect ...')

    await page.goto(redirectUrl, {
      waitUntil: 'networkidle0'
    })

    if (page.url().includes('portal.cfx.re')) {
      core.info('Redirected to CFX Portal. Uploading file ...')

      const cookies = await browser
        .cookies()
        .then(cookies =>
          cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
        )

      const reUploadUrl = `https://portal-api.cfx.re/v1/assets/${assetId}/re-upload`
      const uploadChunkUrl = `https://portal-api.cfx.re/v1/assets/${assetId}/upload-chunk`
      const completeUploadUrl = `https://portal-api.cfx.re/v1/assets/${assetId}/complete-upload`

      const stats = statSync(zipPath)
      const totalSize = stats.size
      const originalFileName = basename(zipPath)
      const chunkCount = Math.ceil(totalSize / chunkSize)

      core.info('Starting upload ...')

      core.debug(`Total size: ${totalSize}`)
      core.debug(`Original file name: ${originalFileName}`)
      core.debug(`Chunk size: ${chunkSize}`)
      core.debug(`Chunk count: ${chunkCount}`)

      const reUploadReponse = await axios.post<ReUploadResponse>(
        reUploadUrl,
        {
          chunk_count: chunkCount,
          chunk_size: chunkSize,
          name: originalFileName,
          original_file_name: originalFileName,
          total_size: totalSize
        },
        {
          headers: {
            Cookie: cookies
          }
        }
      )

      if (reUploadReponse.data.errors !== null) {
        core.debug(JSON.stringify(reUploadReponse.data.errors))
        core.setFailed(
          'Failed to re-upload file. See debug logs for more information.'
        )
        return
      }

      const stream = createReadStream(zipPath, {
        highWaterMark: chunkSize
      })

      let chunkIndex = 0

      for await (const chunk of stream) {
        const form = new FormData()
        form.append('chunk_id', chunkIndex)
        form.append('chunk', chunk, {
          filename: 'blob',
          contentType: 'application/octet-stream'
        })

        await axios.post(uploadChunkUrl, form, {
          headers: {
            ...form.getHeaders(),
            Cookie: cookies
          }
        })

        core.info(`Uploaded chunk ${chunkIndex + 1}/${chunkCount}`)

        chunkIndex++
      }

      await axios.post(
        completeUploadUrl,
        {},
        {
          headers: {
            Cookie: cookies
          }
        }
      )

      core.info('Upload completed.')
    } else {
      core.setFailed('Redirect failed. Make sure the provided Cookie is valid.')
    }
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message)
    }
  } finally {
    await browser.close()
  }
}
