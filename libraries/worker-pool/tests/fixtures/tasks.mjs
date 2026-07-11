import { defineWorkerTasks } from '../../dist/worker.js'

const attempts = new Map()

defineWorkerTasks({
  add(input) {
    return input.a + input.b
  },

  echo(input) {
    return input
  },

  async sleep(input, context) {
    const until = Date.now() + input.ms
    while (Date.now() < until) {
      context.throwIfAborted()
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    return input.value ?? input.ms
  },

  failOnce(input) {
    const count = attempts.get(input.key) ?? 0
    attempts.set(input.key, count + 1)
    if (count < 1) throw new Error('first attempt failed')
    return 'ok'
  },

  alwaysFail() {
    const error = new Error('expected failure')
    error.code = 'EXPECTED'
    throw error
  },

  crash() {
    process.exit(42)
  },
})
