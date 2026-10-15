/**
 * 跨平台「粘贴到光标处」：写剪贴板 → 模拟 Cmd/Ctrl+V → 还原剪贴板。
 * 模拟按键用各 OS 内置工具（零原生依赖）：
 * - macOS：osascript（需辅助功能权限）
 * - Windows：PowerShell SendKeys
 * - Linux：xdotool（X11；Wayland 无则降级为「已复制」）
 */
const { execFile } = require('node:child_process');
const { clipboard } = require('electron');

const PASTE_KEY = process.platform === 'darwin' ? 'Cmd+V' : 'Ctrl+V';

function run(cmd, args, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        err.stdout = stdout;
        reject(err);
      } else resolve(stdout);
    });
    // execFile 超时后只 kill 子进程，这里无需额外处理
    void child;
  });
}

/** 平台各自的模拟粘贴；失败时抛带 code 的错误（ax=缺辅助功能 / no_tool=无可用工具）。 */
async function simulatePaste() {
  if (process.platform === 'darwin') {
    try {
      await run('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down']);
      return;
    } catch (e) {
      const s = `${e.stderr || ''}${e.message || ''}`;
      if (/assistive|accessibility|1002|not allowed/i.test(s)) {
        const err = new Error('需要辅助功能权限：系统设置 → 隐私与安全性 → 辅助功能，勾选 Voice Notes');
        err.code = 'ax';
        throw err;
      }
      throw e;
    }
  }
  if (process.platform === 'win32') {
    await run('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('^v')",
    ]);
    return;
  }
  // Linux：X11 用 xdotool；无则报 no_tool（Wayland 常见）
  await run('xdotool', ['key', 'ctrl+v']);
}

/**
 * 把文字输入到当前焦点窗口。
 * @returns {{pasted:boolean, reason?:'ax'|'no_tool'|'error', message?:string}}
 *          pasted=false 时文字已留在剪贴板，由浮窗提示手动粘贴。
 */
async function deliverText(text) {
  const prev = clipboard.readText(); // 仅快照文本；非文本格式不强还原
  clipboard.writeText(text);
  try {
    await simulatePaste();
  } catch (e) {
    const noTool = e.code === 'ENOENT';
    const reason = e.code === 'ax' ? 'ax' : noTool ? 'no_tool' : 'error';
    const msg = noTool
      ? '未找到 xdotool（Wayland 或未安装），内容已复制'
      : e.code === 'ax'
        ? e.message
        : `模拟粘贴失败（${e.message || e}），内容已复制`;
    return { pasted: false, reason, message: msg };
  }
  // 给目标应用 250ms 完成粘贴，再还原原剪贴板（原本为空则清掉）
  await new Promise((r) => setTimeout(r, 250));
  try {
    clipboard.writeText(prev);
  } catch {
    /* ignore */
  }
  return { pasted: true };
}

module.exports = { deliverText, PASTE_KEY };
