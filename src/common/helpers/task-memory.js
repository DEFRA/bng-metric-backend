import process from 'node:process'
import { totalmem } from 'node:os'

/**
 * How much memory this process is actually allowed.
 *
 * `constrainedMemory()` reads the cgroup limit, which is the number that
 * matters in a container and the one the OOM killer enforces — `totalmem()`
 * reports the HOST's RAM and would happily size a pool for 64 GB the task
 * cannot touch. It answers 0 when there is no limit or it cannot tell, which is
 * the one case where the host figure is the honest answer.
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
  return process.constrainedMemory() || totalmem()
}
