import assert from "node:assert/strict"
import { describe, test } from "node:test"

import {
  hostIsAllowed,
  isPrivateAddress,
  validatePublicUrl,
} from "../src/security.js"

describe("isPrivateAddress", () => {
  test("blocks private, loopback, link-local, and metadata ranges", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.2",
      "172.16.0.1",
      "192.168.1.2",
      "169.254.169.254",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
    ]) {
      assert.equal(isPrivateAddress(address), true, address)
    }
  })

  test("allows public addresses", () => {
    assert.equal(isPrivateAddress("1.1.1.1"), false)
    assert.equal(isPrivateAddress("2606:4700:4700::1111"), false)
  })
})

describe("hostIsAllowed", () => {
  const rules = ["tiktok.com", "*.tiktok.com", "dribbble.com", "*.dribbble.com"]

  test("allows exact hosts and genuine subdomains", () => {
    assert.equal(hostIsAllowed("tiktok.com", rules), true)
    assert.equal(hostIsAllowed("www.tiktok.com", rules), true)
  })

  test("rejects suffix-confusion domains", () => {
    assert.equal(hostIsAllowed("tiktok.com.evil.example", rules), false)
    assert.equal(hostIsAllowed("eviltiktok.com", rules), false)
  })
})

describe("validatePublicUrl", () => {
  const rules = ["example.com", "*.example.com"]

  test("rejects credentials and unexpected ports", async () => {
    await assert.rejects(
      validatePublicUrl("https://user:pass@example.com", rules),
      /credentials/
    )
    await assert.rejects(
      validatePublicUrl("https://example.com:3000", rules),
      /port 80 or 443/
    )
  })

  test("rejects allowed hosts resolving privately", async () => {
    const privateLookup = async () => [{ address: "169.254.169.254", family: 4 }]
    await assert.rejects(
      validatePublicUrl("https://example.com", rules, privateLookup),
      /private or reserved/
    )
  })

  test("returns a public allowed URL", async () => {
    const publicLookup = async () => [{ address: "1.1.1.1", family: 4 }]
    const url = await validatePublicUrl(
      "https://cdn.example.com/image",
      rules,
      publicLookup
    )
    assert.equal(url.hostname, "cdn.example.com")
  })
})
