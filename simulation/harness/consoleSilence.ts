// simulation/harness/consoleSilence.ts
// The sim's tick loop calls console.log periodically (every CONSOLE_OUTPUT_INTERVAL
// ticks — see tick.ts). At windtunnel speed that's tens of thousands of lines per
// seed. Swap console.log for a no-op while ticking, then restore it.

type ConsoleLog = typeof console.log;

let originalLog: ConsoleLog | null = null;
let depth = 0;

export function silenceConsole(): void {
  depth += 1;
  if (depth > 1) return; // already silenced by an outer call
  originalLog = console.log;
  console.log = () => {};
}

export function restoreConsole(): void {
  depth = Math.max(0, depth - 1);
  if (depth > 0) return;
  if (originalLog !== null) {
    console.log = originalLog;
    originalLog = null;
  }
}
