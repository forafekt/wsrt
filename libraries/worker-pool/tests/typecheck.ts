import { createWorkerPool, type WorkerPool } from '../src/index.js'

type Tasks = {
  add: {
    input: { a: number; b: number }
    output: number
  }
  hashFile: {
    input: { path: string }
    output: string
  }
}

const pool: WorkerPool<Tasks> = createWorkerPool<Tasks>({
  worker: new URL('./fixtures/tasks.mjs', import.meta.url),
})

const numberResult: Promise<number> = pool.run('add', { a: 1, b: 2 })
void numberResult

const stringResult: Promise<string> = pool.run('hashFile', { path: './file.txt' })
void stringResult

// @ts-expect-error task input shape is enforced
pool.run('add', { a: 1 })

// @ts-expect-error task names are constrained to the task map
pool.run('missingTask', {})
