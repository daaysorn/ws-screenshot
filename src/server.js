import { createHash, timingSafeEqual } from "node:crypto"
import { createServer } from "node:http"

import { config } from "./config.js"
import { captureScreenshot, closeBrowser } from "./screenshot.js"

const queue = []
let activeCaptures = 0

function json(response, status, body) {
  const content = JSON.stringify(body)
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(content),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  })
  response.end(content)
}

function authorized(request) {
  const header = request.headers.authorization ?? ""
  const expected = `Bearer ${config.apiKey}`
  const suppliedBuffer = Buffer.from(header)
  const expectedBuffer = Buffer.from(expected)
  return (
    suppliedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(suppliedBuffer, expectedBuffer)
  )
}

async function bodyFrom(request) {
  const chunks = []
  let length = 0
  for await (const chunk of request) {
    length += chunk.length
    if (length > config.maxBodyBytes) throw new Error("request body is too large")
    chunks.push(chunk)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    throw new Error("request body must be valid JSON")
  }
}

function integer(value, fallback, minimum, maximum, name) {
  const resolved = value === undefined ? fallback : value
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return resolved
}

function screenshotOptions(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("request body must be an object")
  }
  if (typeof body.url !== "string") throw new Error("url is required")
  const format = body.format ?? "webp"
  if (!["jpeg", "png", "webp"].includes(format)) {
    throw new Error("format must be jpeg, png, or webp")
  }
  return {
    url: body.url,
    format,
    width: integer(body.width, 720, 320, 1_920, "width"),
    height: integer(body.height, 900, 240, 1_200, "height"),
    quality: integer(body.quality, 80, 40, 95, "quality"),
    waitMs: integer(body.waitMs, 1_500, 0, 5_000, "waitMs"),
  }
}

function withCaptureSlot(work) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      activeCaptures += 1
      try {
        resolve(await work())
      } catch (error) {
        reject(error)
      } finally {
        activeCaptures -= 1
        queue.shift()?.()
      }
    }
    if (activeCaptures < config.concurrency) void run()
    else if (queue.length >= 20) reject(new Error("screenshot queue is full"))
    else queue.push(() => void run())
  })
}

const server = createServer(async (request, response) => {
  response.setHeader("X-Frame-Options", "DENY")
  response.setHeader("Referrer-Policy", "no-referrer")

  if (request.method === "GET" && request.url === "/health") {
    return json(response, 200, { status: "ok" })
  }
  if (request.method !== "POST" || request.url !== "/v1/screenshots") {
    return json(response, 404, { error: "not_found" })
  }
  if (!authorized(request)) {
    return json(response, 401, { error: "unauthorized" })
  }
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    return json(response, 415, { error: "content_type_must_be_json" })
  }

  try {
    const options = screenshotOptions(await bodyFrom(request))
    const result = await withCaptureSlot(() => captureScreenshot(options, config))
    response.writeHead(200, {
      "Content-Type": result.contentType,
      "Content-Length": result.data.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Screenshot-Id": createHash("sha256").update(result.data).digest("hex"),
    })
    response.end(result.data)
  } catch (error) {
    const message = error instanceof Error ? error.message : "capture failed"
    console.error(JSON.stringify({ event: "capture_failed", message }))
    return json(response, 422, { error: "capture_failed", message })
  }
})

server.requestTimeout = 35_000
server.headersTimeout = 10_000
server.keepAliveTimeout = 5_000
server.listen(config.port, "0.0.0.0", () => {
  console.log(JSON.stringify({ event: "server_started", port: config.port }))
})

async function shutdown(signal) {
  console.log(JSON.stringify({ event: "server_stopping", signal }))
  server.close()
  await closeBrowser()
  process.exit(0)
}

process.on("SIGTERM", () => void shutdown("SIGTERM"))
process.on("SIGINT", () => void shutdown("SIGINT"))
