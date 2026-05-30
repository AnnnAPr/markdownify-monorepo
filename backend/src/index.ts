import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { ScraperService } from './services/scraper.service.js'

// ---------------------------------------------------------------------------
// Per-IP rate limiter (in-memory, no external dependency)
// Rules: 30 requests per 15-minute window AND 200 requests per day per IP
// ---------------------------------------------------------------------------
const RATE_LIMIT_BURST_MAX = 30
const RATE_LIMIT_BURST_WINDOW = 15 * 60 * 1000 // 15 minutes
const RATE_LIMIT_DAILY_MAX = 200
const RATE_LIMIT_DAILY_WINDOW = 24 * 60 * 60 * 1000 // 24 hours

interface RateEntry {
  // Burst window (15 min)
  burstCount: number
  burstWindowStart: number
  // Daily window (24 hours)
  dailyCount: number
  dailyWindowStart: number
}

const rateLimitMap = new Map<string, RateEntry>()

function checkRateLimit(ip: string): {
  allowed: boolean
  reason?: 'burst' | 'daily'
  resetInMs: number
} {
  const now = Date.now()
  let entry = rateLimitMap.get(ip)

  console.log('entry: ', entry)

  // First request from this IP
  if (!entry) {
    rateLimitMap.set(ip, {
      burstCount: 1,
      burstWindowStart: now,
      dailyCount: 1,
      dailyWindowStart: now,
    })
    return { allowed: true, resetInMs: RATE_LIMIT_BURST_WINDOW }
  }

  // Reset burst window if expired
  if (now - entry.burstWindowStart > RATE_LIMIT_BURST_WINDOW) {
    entry.burstCount = 0
    entry.burstWindowStart = now
  }

  // Reset daily window if expired
  if (now - entry.dailyWindowStart > RATE_LIMIT_DAILY_WINDOW) {
    entry.dailyCount = 0
    entry.dailyWindowStart = now
  }

  // Check daily cap first (stricter — blocks for longer)
  if (entry.dailyCount >= RATE_LIMIT_DAILY_MAX) {
    const resetInMs = RATE_LIMIT_DAILY_WINDOW - (now - entry.dailyWindowStart)
    return { allowed: false, reason: 'daily', resetInMs }
  }

  // Check burst cap
  if (entry.burstCount >= RATE_LIMIT_BURST_MAX) {
    const resetInMs = RATE_LIMIT_BURST_WINDOW - (now - entry.burstWindowStart)
    return { allowed: false, reason: 'burst', resetInMs }
  }

  // Allow — increment both counters
  entry.burstCount++
  entry.dailyCount++
  return { allowed: true, resetInMs: RATE_LIMIT_BURST_WINDOW - (now - entry.burstWindowStart) }
}

const app = new Hono()
const scraperService = new ScraperService()

// Enable CORS for frontend integration
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 600,
  })
)

app.get('/', (c) => {
  return c.json({
    name: 'Markdownify API',
    version: '1.0.0',
    status: 'healthy',
  })
})

app.post('/v1/scrape', async (c) => {
  try {
    // Extract client IP (socket address, with x-forwarded-for fallback for proxies)
    const connInfo = getConnInfo(c)
    const ip =
      c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? connInfo.remote.address ?? 'unknown'

    console.log('ip: ', ip)

    // Check per-IP rate limit
    const rateLimit = checkRateLimit(ip)
    if (!rateLimit.allowed) {
      const resetSecs = Math.ceil(rateLimit.resetInMs / 1000)
      const isDaily = rateLimit.reason === 'daily'
      return c.json(
        {
          status: 'error',
          message: isDaily
            ? `Daily limit reached. You can make ${RATE_LIMIT_DAILY_MAX} requests per day. Try again in ${resetSecs}s.`
            : `Rate limit exceeded. You can make ${RATE_LIMIT_BURST_MAX} requests per 15 minutes. Try again in ${resetSecs}s.`,
        },
        429
      )
    }

    const body = await c.req.json().catch(() => ({}))
    const { url } = body

    if (!url || typeof url !== 'string') {
      return c.json(
        {
          status: 'error',
          message: 'Invalid request: "url" parameter is required and must be a string.',
        },
        400
      )
    }

    // Validate URL structure and security
    try {
      scraperService.validateUrl(url)
    } catch (e: any) {
      return c.json(
        {
          status: 'error',
          message: `Invalid request: ${e.message}`,
        },
        400
      )
    }

    const result = await scraperService.scrape(url)
    return c.json(result)
  } catch (error: any) {
    console.error(`[Scrape Error] ${error.message}`)
    return c.json(
      {
        status: 'error',
        message: error.message || 'An unexpected error occurred during scraping.',
      },
      500
    )
  }
})

const server = serve(
  {
    fetch: app.fetch,
    port: 3001,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)
  }
)

// Graceful shutdown handlers to prevent EADDRINUSE errors on file changes/restarts
const shutdown = () => {
  console.log('\n[Server] Shutting down gracefully...')
  server.close(() => {
    console.log('[Server] Closed out remaining connections.')
    process.exit(0)
  })

  // Force close if taking too long
  setTimeout(() => {
    console.error('[Server] Could not close connections in time, forcefully shutting down')
    process.exit(1)
  }, 3000)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
