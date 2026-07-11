import { createWorkerPool } from '../dist/index.js'

const pool = createWorkerPool({
  worker: new URL('./node-server-worker.mjs', import.meta.url),
  workers: 1,
  defaultTimeoutMs: 5_000,
})

await pool.ready()

try {
  const { baseUrl } = await pool.run('startServer', {
    host: '127.0.0.1',
    port: 0,
  })

  console.log(`worker server listening on ${baseUrl}`)

  const health = await fetch(`${baseUrl}/health`).then((response) => response.json())
  console.log('parent fetch /health:', health)

  const proxied = await pool.run('requestServer', { path: '/work' })
  console.log('worker fetch /work:', proxied)

  console.log('status:', await pool.run('serverStatus', undefined))
} finally {
  await pool.run('stopServer', undefined).catch(() => undefined)
  await pool.shutdown('graceful')
}
