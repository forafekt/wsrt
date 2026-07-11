import { defineWorkerTasks } from '../dist/worker.js'

defineWorkerTasks({
  sumBuffer(buffer) {
    return [...new Uint8Array(buffer)].reduce((total, value) => total + value, 0)
  },
})
