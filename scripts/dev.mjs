/**
 * Cross-platform `next dev` wrapper with the dev.log tee the docs rely on.
 *
 * Replaces `next dev -p 3000 2>&1 | tee dev.log`, which breaks on Windows
 * (no `tee` in cmd.exe). Behaves the same: runs Next dev on port 3000 and
 * appends every stdout/stderr line to dev.log.
 */
import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { join } from 'node:path'

const log = createWriteStream(join(process.cwd(), 'dev.log'), { flags: 'a' })
const child = spawn('npx', ['next', 'dev', '-p', '3000'], {
  shell: true,
  stdio: ['inherit', 'pipe', 'pipe'],
})

function tee(chunk) {
  process.stdout.write(chunk)
  log.write(chunk)
}

child.stdout.on('data', tee)
child.stderr.on('data', tee)
child.on('exit', (code, signal) => {
  log.end()
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
