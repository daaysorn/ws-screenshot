import puppeteer from "puppeteer-core"

import { validatePublicUrl } from "./security.js"

const challengePhrases = [
  "checking your browser",
  "just a moment",
  "verify you are human",
  "verify you're human",
  "security verification",
  "enable javascript and cookies",
  "access denied",
  "captcha",
]

function decodeHtml(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
}

export function openGraphValue(html, property) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const key = tag.match(/(?:property|name)=["']([^"']+)["']/i)?.[1]
    if (key?.toLowerCase() !== property.toLowerCase()) continue
    const content = tag.match(/content=["']([^"']*)["']/i)?.[1]
    if (content) return decodeHtml(content.trim())
  }
  return ""
}

async function openGraphPreview(target, config) {
  let current = target
  for (let redirect = 0; redirect < 4; redirect += 1) {
    await validatePublicUrl(current.toString(), config.allowedHosts)
    const response = await fetch(current, {
      redirect: "manual",
      signal: AbortSignal.timeout(config.navigationTimeoutMs),
      headers: {
        "User-Agent":
          "facebookexternalhit/1.1 (+https://www.facebook.com/externalhit_uatext.php)",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) throw new Error("target redirect had no location")
      current = new URL(location, current)
      continue
    }
    if (!response.ok) throw new Error(`target returned HTTP ${response.status}`)
    const html = (await response.text()).slice(0, 1_000_000)
    const imageUrl = openGraphValue(html, "og:image")
    if (!imageUrl) return null
    const image = await validatePublicUrl(new URL(imageUrl, current).toString())
    return {
      imageUrl: image.toString(),
      title: openGraphValue(html, "og:title"),
    }
  }
  throw new Error("target redirected too many times")
}

async function renderImagePreview(page, preview) {
  await page.setContent(
    "<!doctype html><html><head><style>html,body{width:100%;height:100%;margin:0;background:#111;overflow:hidden}img{width:100%;height:100%;object-fit:cover}</style></head><body></body></html>"
  )
  await page.evaluate(async ({ imageUrl, title }) => {
    document.title = title
    const image = document.createElement("img")
    image.alt = ""
    image.src = imageUrl
    document.body.append(image)
    await image.decode()
  }, preview)
}

let browserPromise

async function browserFor(config) {
  browserPromise ??= puppeteer
    .launch({
      executablePath: config.executablePath,
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-blink-features=AutomationControlled",
      ],
    })
    .catch((error) => {
      browserPromise = undefined
      throw error
    })
  return browserPromise
}

export async function closeBrowser() {
  if (!browserPromise) return
  const browser = await browserPromise.catch(() => null)
  browserPromise = undefined
  await browser?.close()
}

export async function captureScreenshot(options, config) {
  const target = await validatePublicUrl(options.url, config.allowedHosts)
  const browser = await browserFor(config)
  const page = await browser.newPage()
  const validatedHosts = new Map()

  try {
    page.setDefaultNavigationTimeout(config.navigationTimeoutMs)
    await page.setViewport({
      width: options.width,
      height: options.height,
      deviceScaleFactor: 1,
      isMobile: false,
    })
    await page.setUserAgent(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    )
    await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" })
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined })
    })
    await page.setRequestInterception(true)
    page.on("request", (request) => {
      void (async () => {
        try {
          const requestUrl = new URL(request.url())
          if (!["http:", "https:"].includes(requestUrl.protocol)) {
            return requestUrl.protocol === "data:" ? request.continue() : request.abort()
          }

          const cacheKey = requestUrl.hostname.toLowerCase()
          let validation = validatedHosts.get(cacheKey)
          if (!validation) {
            validation = validatePublicUrl(requestUrl.toString())
            validatedHosts.set(cacheKey, validation)
          }
          await validation
          if (!request.isInterceptResolutionHandled()) await request.continue()
        } catch {
          if (!request.isInterceptResolutionHandled()) await request.abort()
        }
      })()
    })

    const useMetadataPreview = /(^|\.)tiktok\.com$/i.test(target.hostname)
    let pageState
    if (useMetadataPreview) {
      const preview = await openGraphPreview(target, config)
      if (!preview) throw new Error("target provided no preview image")
      await renderImagePreview(page, preview)
      pageState = { title: preview.title, text: "", imageCount: 1 }
    } else {
      const response = await page.goto(target.toString(), {
        waitUntil: "domcontentloaded",
        timeout: config.navigationTimeoutMs,
      })
      if (!response || response.status() >= 400) {
        throw new Error(`target returned HTTP ${response?.status() ?? "error"}`)
      }

      await validatePublicUrl(page.url(), config.allowedHosts)
      if (options.waitMs) {
        await new Promise((resolve) => setTimeout(resolve, options.waitMs))
      }

      pageState = await page.evaluate(() => ({
        title: document.title,
        text: document.body?.innerText.slice(0, 4_000) ?? "",
        imageCount: document.images.length,
      }))
    }
    const challengeText = `${pageState.title} ${pageState.text}`.toLowerCase()
    if (challengePhrases.some((phrase) => challengeText.includes(phrase))) {
      throw new Error("target displayed an access challenge")
    }
    if (pageState.imageCount === 0) throw new Error("target rendered no images")

    const data = await page.screenshot({
      type: options.format,
      quality: options.format === "png" ? undefined : options.quality,
      fullPage: false,
      optimizeForSpeed: true,
    })

    return {
      data: Buffer.from(data),
      contentType:
        options.format === "png"
          ? "image/png"
          : options.format === "webp"
            ? "image/webp"
            : "image/jpeg",
      finalUrl: target.toString(),
      title: pageState.title,
    }
  } finally {
    await page.close()
  }
}
