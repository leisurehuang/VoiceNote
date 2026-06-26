import { spawn, type ChildProcess } from 'node:child_process';

export interface ExecOptions {
  /** 按行回调 stdout（用于解析 whisper 进度等）。 */
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  env?: NodeJS.ProcessEnv;
}

export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

export class ExecError extends Error {
  readonly exitCode: number;
  readonly stderr: string;
  constructor(cmd: string, exitCode: number, stderr: string) {
    super(`命令「${cmd}」退出码 ${exitCode}\n${stderr.slice(-800)}`);
    this.name = 'ExecError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/** 把流按行拆分，逐行回调；保留跨 chunk 的不完整行。 */
function makeLineSplitter(onLine?: (line: string) => void) {
  let buf = '';
  return {
    data(chunk: string) {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '');
        buf = buf.slice(i + 1);
        if (line.length) onLine?.(line);
      }
    },
    flush() {
      if (buf.length && buf.trim()) onLine?.(buf.replace(/\r$/, ''));
      buf = '';
    },
  };
}

/** spawn 一个进程并收集输出；可选按行回调。code!=0 时 reject(ExecError)。 */
export function run(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(cmd, args, { env: opts.env });
    } catch (e) {
      reject(e);
      return;
    }

    let stdout = '';
    let stderr = '';
    const outSplit = makeLineSplitter(opts.onStdout);
    const errSplit = makeLineSplitter(opts.onStderr);

    child.stdout?.on('data', (c: Buffer) => {
      const s = c.toString();
      stdout += s;
      outSplit.data(s);
    });
    child.stderr?.on('data', (c: Buffer) => {
      const s = c.toString();
      stderr += s;
      errSplit.data(s);
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      outSplit.flush();
      errSplit.flush();
      const exit = code ?? 0;
      if (exit !== 0) reject(new ExecError(cmd, exit, stderr));
      else resolve({ code: exit, stdout, stderr });
    });
  });
}
