// How the world's cost tests measure (N18 R3.5): by the CPU time of this thread, not by the wall clock, as the program's timing tests do
// (src/core/program/__fixtures__/cpu-clock.ts). The wall clock also counts the time the operating system gives to other processes, so a
// cost test run next to a build or other test workers measured several times what the code costs. `process.threadCpuUsage` (Node
// 23.9+) leaves out V8's GC and compiler threads, which `process.cpuUsage` counts; @types/node 20 does not know it.

/** The CPU time this thread has used, in ms (user + system); the whole process's on a Node without `threadCpuUsage`. */
export function threadCpuMs(): number {
  const threadUsage = (process as NodeJS.Process & { threadCpuUsage?: () => NodeJS.CpuUsage }).threadCpuUsage;
  const { user, system } = threadUsage === undefined ? process.cpuUsage() : threadUsage.call(process);
  return (user + system) / 1000;
}
