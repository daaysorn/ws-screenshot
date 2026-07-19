const integer = (name, fallback, minimum, maximum) => {
  const raw = process.env[name]?.trim()
  const value = raw ? Number(raw) : fallback
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

const apiKey = process.env.API_KEY?.trim() ?? ""
if (apiKey.length < 32) {
  throw new Error("API_KEY must contain at least 32 characters")
}

const allowedHosts = (process.env.ALLOWED_HOSTS ?? "*")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean)

if (!allowedHosts.length) throw new Error("ALLOWED_HOSTS cannot be empty")

export const config = Object.freeze({
  apiKey,
  allowedHosts,
  port: integer("PORT", 3000, 1, 65_535),
  concurrency: integer("MAX_CONCURRENCY", 1, 1, 4),
  navigationTimeoutMs: integer("NAVIGATION_TIMEOUT_MS", 15_000, 3_000, 30_000),
  maxBodyBytes: integer("MAX_BODY_BYTES", 16_384, 1_024, 65_536),
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || "/usr/bin/chromium",
})
