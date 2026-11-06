import process from 'node:process'
import { totalmem } from 'node:os'

/**
 * How much memory this process is actually allowed.
 *
 * `constrainedMemory()` reads the cgroup limit, which is the number that
 * matters in a container and the one the OOM killer enforces — `totalmem()`
 * reports the HOST's RAM and would happily size a pool for 64 GB the task
 * cannot touch. With no limit it answers 0, or on some hosts a huge sentinel
 * instead (UINT64_MAX, 2^64; or 0x7FFFFFFFFFFFF000 on cgroup v1), so anything
 * that is not below the machine's memory is "no limit", and the machine's
 * figure is the honest answer. Seen in perf-test: the sentinel, read as a
 * limit, sized the worker pool's memory budget for 2^64 bytes.
 *
 * On Fargate the fallback is not a downgrade: each task is a microVM sized to
 * the task definition, so the host IS the task. It matters on anything sharing
 * a kernel — a dev box, a CI runner, ECS on EC2.
 *
 * Shared by the worker pool's sizing and the memory backstop's default
 * ceiling, so the two always agree on what the task has.
 * @returns {number}
 */
export function taskMemoryBytes() {
  const machine = totalmem()
  const limit = process.constrainedMemory()
  return limit > 0 && limit < machine ? limit : machine
}
