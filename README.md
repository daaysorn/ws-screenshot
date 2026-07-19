# daaysorn screenshot service

A small, authenticated screenshot API for generating link-preview images. It is
intended to run as a private Coolify service and be called server-to-server by
daaysorn.

The service uses Chromium through Puppeteer, returns a viewport screenshot, and
does not store images. The caller is responsible for validating and persisting
successful results.

## Security model

- Bearer authentication is required for every screenshot request.
- Top-level navigation is controlled by `ALLOWED_HOSTS`. The default `*`
  permits any public host while the private-network protections remain active.
- HTTP authentication in target URLs and nonstandard ports are rejected.
- Loopback, private, link-local, multicast, reserved, and cloud-metadata IP
  ranges are blocked after DNS resolution.
- Every browser request, including redirects and page subresources, receives a
  public-address check.
- Dimensions, quality, wait time, body size, navigation time, concurrency, and
  queue size are bounded.
- Access challenges and pages without images are returned as failures instead
  of misleading previews.
- There is no browser UI, WebSocket API, PDF generation, arbitrary header
  injection, cookie injection, or permissive CORS policy.

Keep the service behind HTTPS. Do not expose the container port directly when a
Coolify proxy is available.

## API

### Health

```http
GET /health
```

### Capture a screenshot

```http
POST /v1/screenshots
Authorization: Bearer <API_KEY>
Content-Type: application/json

{
  "url": "https://www.tiktok.com/@creator/video/123",
  "width": 720,
  "height": 900,
  "format": "webp",
  "quality": 80,
  "waitMs": 1500
}
```

The response body is the image. Supported formats are `webp`, `jpeg`, and
`png`. The defaults shown above are used when optional fields are omitted.

Example:

```bash
curl --fail-with-body \
  --request POST \
  --header "Authorization: Bearer $API_KEY" \
  --header "Content-Type: application/json" \
  --data '{"url":"https://dribbble.com/shots/25762763-Comments-section-for-blog"}' \
  --output preview.webp \
  https://screenshots.example.com/v1/screenshots
```

## Coolify deployment

1. Create a new application from this Git repository.
2. Use the repository `Dockerfile` and expose container port `3000`.
3. Configure `/health` as the health-check path.
4. Add the required environment variables below.
5. Attach an HTTPS domain, deploy, and test `/health`.
6. Keep the Coolify resource limit conservative initially: 1 CPU and 1–2 GB
   RAM is sufficient for `MAX_CONCURRENCY=1`.

Generate the API key with:

```bash
openssl rand -hex 32
```

Do not place `API_KEY` in a URL or commit it to the repository.

## Environment variables

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `API_KEY` | Yes | — | Secret with at least 32 characters |
| `ALLOWED_HOSTS` | No | `*` | `*` for any public host, or a comma-separated navigation allowlist |
| `PORT` | No | `3000` | HTTP port |
| `MAX_CONCURRENCY` | No | `1` | Simultaneous Chromium pages, maximum 4 |
| `NAVIGATION_TIMEOUT_MS` | No | `15000` | Navigation timeout, 3–30 seconds |
| `MAX_BODY_BYTES` | No | `16384` | Maximum JSON body size |
| `PUPPETEER_EXECUTABLE_PATH` | No | `/usr/bin/chromium` | Chromium executable |

Use `*` to capture any public website. For a restricted deployment, host rules
are exact by default: `*.tiktok.com` allows subdomains but does not allow
`tiktok.com.evil.example`. Every mode still rejects private and reserved IPs.

## Local verification

Node.js 22.12 or later is required.

```bash
npm ci
npm test
npm run check
```

Running the full API locally also requires a compatible Chromium executable:

```bash
API_KEY="$(openssl rand -hex 32)" \
PUPPETEER_EXECUTABLE_PATH="/path/to/chromium" \
npm start
```

## License

MIT. This fork is based on `elestio/ws-screenshot` and retains its license.
