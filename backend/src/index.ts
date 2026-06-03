import dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { serve } from '@hono/node-server'
import { getConnInfo } from '@hono/node-server/conninfo'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { ScraperService } from './services/scraper.service.js'
import { metricsService } from './services/metrics.service.js'

// ---------------------------------------------------------------------------
// Per-IP rate limiter (in-memory, no external dependency)
// Rules: 30 requests per 15-minute window AND 100 requests per day per IP
// ---------------------------------------------------------------------------
const RATE_LIMIT_BURST_MAX = 30
const RATE_LIMIT_BURST_WINDOW = 15 * 60 * 1000 // 15 minutes
const RATE_LIMIT_DAILY_MAX = 100
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

function getRateLimitInfo(ip: string) {
  const now = Date.now()
  const entry = rateLimitMap.get(ip)

  if (!entry) {
    return {
      burstLimit: RATE_LIMIT_BURST_MAX,
      burstRemaining: RATE_LIMIT_BURST_MAX,
      burstResetInMs: RATE_LIMIT_BURST_WINDOW,
      dailyLimit: RATE_LIMIT_DAILY_MAX,
      dailyRemaining: RATE_LIMIT_DAILY_MAX,
      dailyResetInMs: RATE_LIMIT_DAILY_WINDOW,
    }
  }

  // Calculate current effective burst count & reset time
  let burstCount = entry.burstCount
  let burstResetInMs = RATE_LIMIT_BURST_WINDOW - (now - entry.burstWindowStart)
  if (now - entry.burstWindowStart > RATE_LIMIT_BURST_WINDOW) {
    burstCount = 0
    burstResetInMs = RATE_LIMIT_BURST_WINDOW
  }

  // Calculate current effective daily count & reset time
  let dailyCount = entry.dailyCount
  let dailyResetInMs = RATE_LIMIT_DAILY_WINDOW - (now - entry.dailyWindowStart)
  if (now - entry.dailyWindowStart > RATE_LIMIT_DAILY_WINDOW) {
    dailyCount = 0
    dailyResetInMs = RATE_LIMIT_DAILY_WINDOW
  }

  return {
    burstLimit: RATE_LIMIT_BURST_MAX,
    burstRemaining: Math.max(0, RATE_LIMIT_BURST_MAX - burstCount),
    burstResetInMs: Math.max(0, burstResetInMs),
    dailyLimit: RATE_LIMIT_DAILY_MAX,
    dailyRemaining: Math.max(0, RATE_LIMIT_DAILY_MAX - dailyCount),
    dailyResetInMs: Math.max(0, dailyResetInMs),
  }
}

async function checkRateLimit(ip: string): Promise<{
  allowed: boolean
  reason?: 'burst' | 'daily'
  resetInMs: number
}> {
  const now = Date.now()
  let entry = rateLimitMap.get(ip)

  // First request from this IP
  if (!entry) {
    rateLimitMap.set(ip, {
      burstCount: 1,
      burstWindowStart: now,
      dailyCount: 1,
      dailyWindowStart: now,
    })
    await metricsService.recordRequest(ip)
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
    await metricsService.recordFailure()
    const resetInMs = RATE_LIMIT_DAILY_WINDOW - (now - entry.dailyWindowStart)
    return { allowed: false, reason: 'daily', resetInMs }
  }

  // Check burst cap
  if (entry.burstCount >= RATE_LIMIT_BURST_MAX) {
    await metricsService.recordFailure()
    const resetInMs = RATE_LIMIT_BURST_WINDOW - (now - entry.burstWindowStart)
    return { allowed: false, reason: 'burst', resetInMs }
  }

  // Allow — increment both counters
  entry.burstCount++
  entry.dailyCount++
  await metricsService.recordRequest(ip)
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

app.get('/v1/rate-limit', (c) => {
  const connInfo = getConnInfo(c)
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? connInfo.remote.address ?? 'unknown'
  const limitInfo = getRateLimitInfo(ip)
  return c.json({
    status: 'success',
    rateLimit: limitInfo,
  })
})

app.get('/v1/metrics', async (c) => {
  const snapshot = await metricsService.getSnapshot()
  return c.json({
    status: 'success',
    ...snapshot,
  })
})

app.post('/v1/scrape', async (c) => {
  const connInfo = getConnInfo(c)
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? connInfo.remote.address ?? 'unknown'
  console.log('[Scrape] IP:', ip)

  try {
    // Check per-IP rate limit
    const rateLimit = await checkRateLimit(ip)
    if (!rateLimit.allowed) {
      const resetSecs = Math.ceil(rateLimit.resetInMs / 1000)
      const isDaily = rateLimit.reason === 'daily'
      const limitInfo = getRateLimitInfo(ip)
      return c.json(
        {
          status: 'error',
          message: isDaily
            ? `Daily limit reached. You can make ${RATE_LIMIT_DAILY_MAX} requests per day. Try again in ${resetSecs}s.`
            : `Rate limit exceeded. You can make ${RATE_LIMIT_BURST_MAX} requests per 15 minutes. Try again in ${resetSecs}s.`,
          rateLimit: limitInfo,
        },
        429
      )
    }

    const body = await c.req.json().catch(() => ({}))
    const { url } = body

    if (!url || typeof url !== 'string') {
      const limitInfo = getRateLimitInfo(ip)
      return c.json(
        {
          status: 'error',
          message: 'Invalid request: "url" parameter is required and must be a string.',
          rateLimit: limitInfo,
        },
        400
      )
    }

    // Validate URL structure and security
    try {
      scraperService.validateUrl(url)
    } catch (e: any) {
      const limitInfo = getRateLimitInfo(ip)
      return c.json(
        {
          status: 'error',
          message: `Invalid request: ${e.message}`,
          rateLimit: limitInfo,
        },
        400
      )
    }

    const result = await scraperService.scrape(url)
    await metricsService.recordUrlRequest(ip)
    await metricsService.recordSuccess(result.tokensSavedEstimate, result.wordCount)
    const limitInfo = getRateLimitInfo(ip)
    return c.json({
      ...result,
      rateLimit: limitInfo,
    })
  } catch (error: any) {
    console.error(`[Scrape Error] ${error.message}`)
    await metricsService.recordFailure()
    const limitInfo = getRateLimitInfo(ip)
    return c.json(
      {
        status: 'error',
        message: error.message || 'An unexpected error occurred during scraping.',
        rateLimit: limitInfo,
      },
      500
    )
  }
})

app.post('/v1/convert', async (c) => {
  const connInfo = getConnInfo(c)
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? connInfo.remote.address ?? 'unknown'
  console.log('[Convert] IP:', ip)

  try {
    // Check rate limit
    const rateLimit = await checkRateLimit(ip)
    if (!rateLimit.allowed) {
      return c.json(
        {
          status: 'error',
          message:
            rateLimit.reason === 'daily'
              ? `Daily limit reached. You can make ${RATE_LIMIT_DAILY_MAX} requests per day. Try again in ${Math.ceil(rateLimit.resetInMs / 1000)}s.`
              : `Rate limit exceeded. You can make ${RATE_LIMIT_BURST_MAX} requests per 15 minutes. Try again in ${Math.ceil(rateLimit.resetInMs / 1000)}s.`,
          rateLimit: getRateLimitInfo(ip),
        },
        429
      )
    }

    const body = await c.req.json().catch(() => ({}))
    const { html } = body

    if (!html || typeof html !== 'string') {
      const limitInfo = getRateLimitInfo(ip)
      return c.json(
        {
          status: 'error',
          message: 'Invalid request: "html" parameter is required and must be a string.',
          rateLimit: limitInfo,
        },
        400
      )
    }

    const result = await scraperService.convertHtml(html)
    await metricsService.recordHtmlRequest(ip)
    await metricsService.recordSuccess(result.tokensSavedEstimate, result.wordCount)
    const limitInfo = getRateLimitInfo(ip)
    return c.json({
      ...result,
      rateLimit: limitInfo,
    })
  } catch (error: any) {
    console.error(`[Convert Error] ${error.message}`)
    await metricsService.recordFailure()
    const limitInfo = getRateLimitInfo(ip)
    return c.json(
      {
        status: 'error',
        message: error.message || 'An unexpected error occurred during direct HTML conversion.',
        rateLimit: limitInfo,
      },
      500
    )
  }
})

const PORT = parseInt(process.env.PORT || '3001', 10)

const server = serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)
  }
)

// Graceful shutdown handlers to prevent EADDRINUSE errors on file changes/restarts
const shutdown = () => {
  console.log('\n[Server] Shutting down...')
  server.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
