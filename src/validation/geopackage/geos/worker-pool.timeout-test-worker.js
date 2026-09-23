import { parentPort } from 'node:worker_threads'

// Test fixture for the pool's timeout lifecycle: it is ready to accept work,
// then intentionally never replies, forcing the pool to terminate and replace
// it when the per-job deadline fires.
parentPort.postMessage({ ready: true, geosVersion: 'test' })
parentPort.on('message', () => {
  // Deliberately leave validation jobs unanswered until the pool terminates us.
})
