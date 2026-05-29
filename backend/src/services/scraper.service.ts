import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import TurndownService from 'turndown'
import { encode } from 'gpt-tokenizer'

export interface ScrapeOptions {
  removeImages?: boolean
}

export interface ScrapeResult {
  status: 'success' | 'error'
  title: string
  author: string | null
  publishedDate: string | null
  wordCount: number
  rawTokenCount: number
  cleanTokenCount: number
  tokensSavedEstimate: number
  savingsPercent: number
  markdown: string
}

export class ScraperService {
  private turndownService: TurndownService

  constructor() {
    this.turndownService = new TurndownService({
      headingStyle: 'atx',
      hr: '---',
      bulletListMarker: '-',
      codeBlockStyle: 'fenced',
      emDelimiter: '_',
    })

    // Add a rule to remove image tags from the markdown output
    this.turndownService.addRule('remove-images', {
      filter: ['img'],
      replacement: () => '',
    })
  }

  /**
   * Fetches the raw HTML content from a given URL.
   * Mimics a realistic browser user agent to avoid simple blocking.
   */
  async fetchHtml(url: string): Promise<string> {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        // Timeout signal (10 seconds)
        signal: AbortSignal.timeout(10000),
      })

      if (!response.ok) {
        throw new Error(
          `Failed to fetch page. HTTP Status: ${response.status} ${response.statusText}`
        )
      }

      return await response.text()
    } catch (error: any) {
      if (error.name === 'TimeoutError') {
        throw new Error('Request timed out after 10 seconds.')
      }
      throw new Error(`Failed to fetch HTML: ${error.message}`)
    }
  }

  /**
   * Main scrape logic: extracts clean HTML using Mozilla Readability,
   * converts to Markdown, and calculates metrics.
   */
  async scrape(url: string, options: ScrapeOptions = {}): Promise<ScrapeResult> {
    const rawHtml = await this.fetchHtml(url)

    // Calculate raw token count
    let rawTokenCount = 0
    try {
      rawTokenCount = encode(rawHtml).length
    } catch (e) {
      // Fallback simple estimation if tokenizer fails on huge raw inputs
      rawTokenCount = Math.ceil(rawHtml.length / 4)
    }

    // Parse DOM with JSDOM
    const dom = new JSDOM(rawHtml, { url })
    const document = dom.window.document

    // Remove scripts, styles, iframes, and other non-article nodes
    const removeElements = document.querySelectorAll('script, style, iframe, noscript')
    removeElements.forEach((el) => el.remove())

    // Extract main content with Mozilla Readability
    const reader = new Readability(document)
    const article = reader.parse()

    if (!article) {
      throw new Error(
        'Failed to extract readable content from the webpage. The page may lack clear structured text.'
      )
    }

    // Convert content to Markdown using Turndown
    const markdown = this.turndownService.turndown(article.content || '').trim()

    if (!markdown) {
      throw new Error('Extracted content resulted in an empty Markdown string.')
    }

    // Calculate clean markdown word and token count
    const wordCount = markdown.split(/\s+/).filter((word) => word.length > 0).length

    let cleanTokenCount = 0
    try {
      cleanTokenCount = encode(markdown).length
    } catch (e) {
      cleanTokenCount = Math.ceil(markdown.length / 4)
    }

    const tokensSavedEstimate = Math.max(0, rawTokenCount - cleanTokenCount)
    const savingsPercent =
      rawTokenCount > 0 ? Math.round((tokensSavedEstimate / rawTokenCount) * 100) : 0

    return {
      status: 'success',
      title: article.title || 'Untitled',
      author: article.byline || null,
      publishedDate: null, // Readability doesn't always provide publish date natively, can be expanded later
      wordCount,
      rawTokenCount,
      cleanTokenCount,
      tokensSavedEstimate,
      savingsPercent,
      markdown,
    }
  }
}
