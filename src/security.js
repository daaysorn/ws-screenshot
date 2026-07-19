import { lookup } from "node:dns/promises"
import { isIP } from "node:net"

const blockedIpv4 = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
]

function ipv4Number(address) {
  return address
    .split(".")
    .reduce((value, part) => (value << 8) + Number(part), 0) >>> 0
}

function ipv4InCidr(address, network, prefix) {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (ipv4Number(address) & mask) === (ipv4Number(network) & mask)
}

export function isPrivateAddress(address) {
  const normalized = address.toLowerCase().split("%")[0]
  if (isIP(normalized) === 4) {
    return blockedIpv4.some(([network, prefix]) =>
      ipv4InCidr(normalized, network, prefix)
    )
  }

  if (isIP(normalized) !== 6) return true
  if (normalized === "::" || normalized === "::1") return true
  if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true
  if (/^fe[89ab]/.test(normalized)) return true
  if (normalized.startsWith("ff")) return true

  const mappedIpv4 = normalized.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  if (mappedIpv4) return isPrivateAddress(mappedIpv4)

  const mappedHex = normalized.match(/::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/)
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1], 16)
    const low = Number.parseInt(mappedHex[2], 16)
    return isPrivateAddress(
      `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`
    )
  }

  return false
}

export function hostIsAllowed(hostname, allowedHosts) {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  return allowedHosts.some((rule) => {
    if (rule.startsWith("*.")) {
      const suffix = rule.slice(1)
      return host.endsWith(suffix) && host.length > suffix.length
    }
    return host === rule
  })
}

export async function validatePublicUrl(value, allowedHosts = null, dnsLookup = lookup) {
  let url
  try {
    url = new URL(value)
  } catch {
    throw new Error("url must be a valid absolute URL")
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error("url must use HTTP or HTTPS")
  }
  if (url.username || url.password) throw new Error("url credentials are not allowed")
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error("url must use port 80 or 443")
  }
  if (allowedHosts && !hostIsAllowed(url.hostname, allowedHosts)) {
    throw new Error("url host is not allowed")
  }

  const addresses = isIP(url.hostname)
    ? [{ address: url.hostname }]
    : await dnsLookup(url.hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("url resolves to a private or reserved address")
  }

  return url
}
