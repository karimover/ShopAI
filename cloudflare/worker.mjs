import { env } from 'cloudflare:workers'
import { httpServerHandler } from 'cloudflare:node'
import { createApp } from '../server/index.mjs'

const emptyDatabase = { users: [], sessions: [], stores: [], products: [], orders: [] }

const persistence = {
  async load() {
    const row = await env.DB
      .prepare('SELECT payload, revision FROM app_state WHERE id = ?')
      .bind('shopai')
      .first()

    if (!row) {
      return { data: emptyDatabase, revision: 0 }
    }

    return {
      data: JSON.parse(row.payload),
      revision: Number(row.revision),
    }
  },

  async save(payload, expectedRevision) {
    const result = await env.DB
      .prepare('UPDATE app_state SET payload = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?')
      .bind(payload, 'shopai', expectedRevision)
      .run()

    if (result.meta?.changes !== 1) {
      throw new Error('DB_WRITE_CONFLICT')
    }

    return expectedRevision + 1
  },
}

const uploadStorage = {
  maxBytes: 1_800_000,

  async put(filename, data, contentType) {
    await env.DB
      .prepare('INSERT OR REPLACE INTO uploads (filename, content_type, data) VALUES (?, ?, ?)')
      .bind(filename, contentType, data)
      .run()
  },

  async get(filename) {
    const row = await env.DB
      .prepare('SELECT data, content_type FROM uploads WHERE filename = ?')
      .bind(filename)
      .first()

    if (!row) return null

    return {
      data: row.data,
      contentType: row.content_type || 'application/octet-stream',
    }
  },
}

const app = await createApp({
  runtimeConfig: {
    CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
    SHOPAI_CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_AI_MODEL: env.CLOUDFLARE_AI_MODEL || '@cf/google/gemma-4-26b-a4b-it',
  },
  persistence,
  uploadStorage,
  secureCookies: true,
  assetsServedExternally: true,
})

app.listen(3000)

export default httpServerHandler({ port: 3000 })
