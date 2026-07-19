import assert from "node:assert/strict"
import { describe, test } from "node:test"

import { openGraphValue } from "../src/screenshot.js"

describe("openGraphValue", () => {
  test("reads attributes in either order and decodes URLs", () => {
    const html = `
      <meta property="og:title" content="A preview">
      <meta content="https://cdn.example/image.jpg?a=1&amp;b=2" property="og:image">
    `
    assert.equal(openGraphValue(html, "og:title"), "A preview")
    assert.equal(
      openGraphValue(html, "og:image"),
      "https://cdn.example/image.jpg?a=1&b=2"
    )
  })

  test("does not confuse similarly named metadata", () => {
    assert.equal(
      openGraphValue('<meta property="og:image:width" content="1200">', "og:image"),
      ""
    )
  })
})
