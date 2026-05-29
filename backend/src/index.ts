import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { ScraperService } from './services/scraper.service.js'

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

    // Validate URL structure
    try {
      new URL(url)
    } catch (_) {
      return c.json(
        {
          status: 'error',
          message:
            'Invalid request: "url" must be a valid absolute URL (e.g., https://example.com).',
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

serve(
  {
    fetch: app.fetch,
    port: 3001,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`)
  }
)
