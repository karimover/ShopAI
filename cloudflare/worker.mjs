import { httpServerHandler } from 'cloudflare:node'
import { createApp } from '../server/index.mjs'

const emptyDatabase = { users: [], sessions: [], stores: [], products: [], orders: [] }

function createPersistence(DB) {
  return {
    async load() {
      const row = await DB
        .prepare('SELECT payload, revision FROM app_state WHERE id = ?')
        .bind('shopai')
        .first()

      if (!row) return { data: emptyDatabase, revision: 0 }

      return {
        data: JSON.parse(row.payload),
        revision: Number(row.revision),
      }
    },

    async save(payload, expectedRevision) {
      const result = await DB
        .prepare('UPDATE app_state SET payload = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?')
        .bind(payload, 'shopai', expectedRevision)
        .run()

      if (result.meta?.changes !== 1) {
        throw new Error('DB_WRITE_CONFLICT')
      }

      return expectedRevision + 1
    },
  }
}

function createUploadStorage(DB) {
  return {
    maxBytes: 1_800_000,

    async put(filename, data, contentType) {
      await DB
        .prepare('INSERT OR REPLACE INTO uploads (filename, content_type, data) VALUES (?, ?, ?)')
        .bind(filename, contentType, data)
        .run()
    },

    async get(filename) {
      const row = await DB
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
}

let appPromise

async function getApp(env) {
  if (!env.DB) {
    throw new Error('D1 binding DB is missing. Check d1_databases in wrangler.jsonc.')
  }

  if (!appPromise) {
    appPromise = createApp({
      runtimeConfig: {
        CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
        SHOPAI_CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
        CLOUDFLARE_AI_MODEL: env.CLOUDFLARE_AI_MODEL || '@cf/google/gemma-4-26b-a4b-it',
      },
      persistence: createPersistence(env.DB),
      uploadStorage: createUploadStorage(env.DB),
      secureCookies: true,
      assetsServedExternally: true,
      fetchBodyParser: true,
    }).catch((error) => {
      appPromise = undefined
      throw error
    })
  }

  return appPromise
}

export default {
  async fetch(request, env, ctx) {
    const app = await getApp(env)
    if (!globalThis.__shopaiHttpHandler) {
      globalThis.__shopaiHttpHandler = httpServerHandler({ port: 3000 })
      app.listen(3000)
    }
    return globalThis.__shopaiHttpHandler.fetch(request, env, ctx)
  },
}
