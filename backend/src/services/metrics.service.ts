import { createClient } from '@supabase/supabase-js'

class MetricsService {
  private supabase: any = null
  private initialized = false

  private getClient() {
    if (!this.initialized) {
      const supabaseUrl = process.env.SUPABASE_URL
      const supabaseKey = process.env.SUPABASE_KEY
      console.log('[Metrics] Initializing - URL set:', !!supabaseUrl, 'KEY set:', !!supabaseKey)
      if (supabaseUrl && supabaseKey) {
        this.supabase = createClient(supabaseUrl, supabaseKey)
        console.log('[Metrics] Supabase client initialized')
      }
      this.initialized = true
    }
    return this.supabase
  }

  // Increment metric column in DB
  private async updateField(field: string, value: number): Promise<void> {
    const client = this.getClient()
    if (!client) return
    try {
      const { error } = await client.rpc('increment_metric', {
        field_name: field,
        increment_by: value,
      })
      if (error) console.error(`[Metrics] increment_metric error for ${field}:`, error)
    } catch (e) {
      console.error(`[Metrics] Failed to update ${field}:`, e)
    }
  }

  // Update JSONB stats for a given IP address
  private async updateIpStats(ip: string, type: 'urls' | 'htmls' | 'views'): Promise<void> {
    const client = this.getClient()
    if (!client) return

    try {
      const { error } = await client.rpc('update_ip_stats', {
        p_ip: ip,
        p_type: type,
      })
      if (error) console.error('[Metrics] update_ip_stats error:', error)
    } catch (e) {
      console.error('[Metrics] Failed to update IP stats:', e)
    }
  }

  async recordRequest(ip: string): Promise<void> {
    await this.updateField('total_requests', 1)
  }

  async recordCacheHit(): Promise<void> {
    await this.updateField('cache_hits', 1)
  }

  async recordPageView(ip: string): Promise<void> {
    await this.updateField('page_views', 1)
    await this.updateIpStats(ip, 'views')
  }

  async recordSuccess(tokensSaved: number, wordCount: number): Promise<void> {
    await this.updateField('successes', 1)
    await this.updateField('tokens_saved', tokensSaved)
    await this.updateField('word_count', wordCount)
  }

  async recordFailure(): Promise<void> {
    await this.updateField('failures', 1)
  }

  async recordUrlRequest(ip: string): Promise<void> {
    await this.updateIpStats(ip, 'urls')
  }

  async recordHtmlRequest(ip: string): Promise<void> {
    await this.updateIpStats(ip, 'htmls')
  }

  async getSnapshot(): Promise<
    Record<string, unknown> & {
      totalRequests: number
      uniqueIps: number
      cacheHits: number
      successes: number
      failures: number
      totalTokensSaved: number
      totalWordCount: number
      urlRequests: number
      htmlRequests: number
      pageViews: number
    }
  > {
    const client = this.getClient()
    if (!client) {
      console.log('[Metrics] No supabase client - returning zeros')
      return {
        totalRequests: 0,
        uniqueIps: 0,
        cacheHits: 0,
        successes: 0,
        failures: 0,
        totalTokensSaved: 0,
        totalWordCount: 0,
        urlRequests: 0,
        htmlRequests: 0,
        pageViews: 0,
      }
    }

    try {
      const { data, error } = await client.from('app_metrics').select('*').eq('id', 1).single()
      if (error) {
        console.error('[Metrics] getSnapshot error:', error)
        return {
          totalRequests: 0,
          uniqueIps: 0,
          cacheHits: 0,
          successes: 0,
          failures: 0,
          totalTokensSaved: 0,
          totalWordCount: 0,
          urlRequests: 0,
          htmlRequests: 0,
          pageViews: 0,
        }
      }
      console.log('[Metrics] Data from DB:', data)
      return {
        totalRequests: data?.total_requests || 0,
        uniqueIps: data?.unique_ips || 0,
        cacheHits: data?.cache_hits || 0,
        successes: data?.successes || 0,
        failures: data?.failures || 0,
        totalTokensSaved: data?.tokens_saved || 0,
        totalWordCount: data?.word_count || 0,
        urlRequests: data?.ip_stats
          ? Object.values(data.ip_stats).reduce((sum: number, s: any) => sum + (s.urls || 0), 0)
          : 0,
        htmlRequests: data?.ip_stats
          ? Object.values(data.ip_stats).reduce((sum: number, s: any) => sum + (s.htmls || 0), 0)
          : 0,
        pageViews: data?.page_views || 0,
        ipStats: data?.ip_stats || {},
      }
    } catch (e) {
      console.error('[Metrics] Failed to load metrics:', e)
      return {
        totalRequests: 0,
        uniqueIps: 0,
        cacheHits: 0,
        successes: 0,
        failures: 0,
        totalTokensSaved: 0,
        totalWordCount: 0,
        urlRequests: 0,
        htmlRequests: 0,
        pageViews: 0,
      }
    }
  }
}

export const metricsService = new MetricsService()
