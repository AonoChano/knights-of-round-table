import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");
const quiet = args.has("--quiet");
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..").toLowerCase();

function log(message) {
  if (!quiet) console.log(`[dev-stop] ${message}`);
}

function loadWindowsProcesses() {
  const ps = [
    "$ErrorActionPreference='Stop';",
    "Get-CimInstance Win32_Process |",
    "Select-Object ProcessId,ParentProcessId,Name,CommandLine |",
    "ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
    { encoding: "utf8" }
  );
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || "Unable to query Windows processes");
  }
  const text = result.stdout.trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function isKortDevRoot(processInfo) {
  const cmd = String(processInfo.CommandLine ?? "").toLowerCase();
  if (!cmd) return false;

  const isKortUvicorn =
    cmd.includes("uvicorn kort_api.main:app") &&
    cmd.includes("--app-dir src") &&
    cmd.includes("--port 8000");

  const isKortConcurrently =
    cmd.includes(repoRoot) &&
    cmd.includes("concurrently") &&
    cmd.includes("dev:api") &&
    cmd.includes("dev:web");

  const isKortNext =
    cmd.includes(repoRoot) &&
    (cmd.includes("next\\dist\\bin\\next") ||
      cmd.includes("next/dist/bin/next") ||
      (cmd.includes("next") && cmd.includes("start-server.js")));

  return isKortUvicorn || isKortConcurrently || isKortNext;
}

function collectProcessTree(processes, rootIds) {
  const targets = new Set(rootIds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of processes) {
      const pid = Number(item.ProcessId);
      const parent = Number(item.ParentProcessId);
      if (!targets.has(pid) && targets.has(parent)) {
        targets.add(pid);
        changed = true;
      }
    }
  }
  return targets;
}

function rootTargetsOnly(processes, targetIds) {
  return processes
    .filter((item) => targetIds.has(Number(item.ProcessId)))
    .filter((item) => !targetIds.has(Number(item.ParentProcessId)))
    .map((item) => Number(item.ProcessId));
}

function main() {
  if (process.platform !== "win32") {
    log("process cleanup is currently Windows-only; skipping.");
    return;
  }

  const processes = loadWindowsProcesses();
  const roots = processes
    .filter(isKortDevRoot)
    .map((item) => Number(item.ProcessId))
    .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);

  if (roots.length === 0) {
    log("no KORT dev processes found.");
    return;
  }

  const targetIds = collectProcessTree(processes, roots);
  const targetList = processes
    .filter((item) => targetIds.has(Number(item.ProcessId)))
    .map((item) => `${item.ProcessId}:${item.Name}`)
    .join(", ");

  if (checkOnly) {
    log(`matched KORT dev processes: ${targetList}`);
    return;
  }

  const killRoots = rootTargetsOnly(processes, targetIds);
  for (const pid of killRoots) {
    try {
      execFileSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: quiet ? "ignore" : "inherit" });
    } catch (error) {
      if (!quiet) {
        console.warn(`[dev-stop] failed to stop PID ${pid}: ${error.message}`);
      }
    }
  }
  log(`stopped KORT dev process tree: ${targetList}`);
}

main();
