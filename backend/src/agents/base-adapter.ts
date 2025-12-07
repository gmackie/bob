import { spawn, ChildProcess } from 'child_process';
import { spawn as spawnPty, IPty } from 'node-pty';
import { AgentAdapter, AgentType } from '../types.js';

export abstract class BaseAgentAdapter implements AgentAdapter {
  abstract readonly type: AgentType;
  abstract readonly name: string;
  abstract readonly command: string;

  async checkAvailability(): Promise<{ isAvailable: boolean; version?: string; statusMessage?: string }> {
    try {
      const result = await this.runCommand(['--version']);
      return {
        isAvailable: true,
        version: this.parseVersion(result.stdout),
        statusMessage: 'Available'
      };
    } catch (error) {
      return {
        isAvailable: false,
        statusMessage: error instanceof Error ? error.message : 'Command not found'
      };
    }
  }

  async checkAuthentication(): Promise<{ isAuthenticated: boolean; authenticationStatus?: string; statusMessage?: string }> {
    // Default implementation - override in specific adapters if they have auth
    return {
      isAuthenticated: true,
      authenticationStatus: 'Not required',
      statusMessage: 'No authentication required'
    };
  }

  async startProcess(worktreePath: string, port?: number): Promise<IPty> {
    const { command, args, env } = this.getSpawnArgs({ interactive: true, port });

    return new Promise(async (resolve, reject) => {
      console.log(`Starting ${this.name} PTY in directory: ${worktreePath}`);

      const ptyProcess = spawnPty(command, args, {
        cwd: worktreePath,
        cols: 120,
        rows: 40,
        env: {
          ...process.env,
          ...env
        } as { [key: string]: string }
      });

      // Give the PTY a moment to fully initialize before the agent starts
      // This prevents cursor position query errors during startup
      await new Promise(r => setTimeout(r, 500));

      // Pre-warm the terminal by sending a cursor position response
      // This helps tools like Codex that query terminal capabilities immediately
      ptyProcess.write('\x1b[1;1R');

      let spawned = false;
      let output = '';

      ptyProcess.onData((data: string) => {
        const MAX_OUTPUT_LENGTH = 10000;
        output += data;
        if (output.length > MAX_OUTPUT_LENGTH) {
          output = output.slice(-MAX_OUTPUT_LENGTH / 2);
        }

        if (data.length < 100 && this.isReadyOutput(data, output)) {
          console.log(`${this.name} PTY output:`, data.substring(0, 200));
        }

        if (!spawned && this.isAgentReady(data, output)) {
          spawned = true;
          console.log(`${this.name} PTY ready for worktree ${worktreePath} with PID ${ptyProcess.pid}`);
          resolve(ptyProcess);
        }
      });

      ptyProcess.onExit(() => {
        console.log(`${this.name} PTY process exited`);
        if (!spawned) {
          reject(new Error(`${this.name} PTY process exited unexpectedly. Output: ${output}`));
        }
      });

      // Timeout as fallback
      const timeout = setTimeout(() => {
        if (!spawned) {
          ptyProcess.kill();
          reject(new Error(`${this.name} PTY failed to start within timeout. Output: ${output}`));
        }
      }, 10000);

      // Fallback assumption after delay
      setTimeout(() => {
        if (!spawned) {
          spawned = true;
          clearTimeout(timeout);
          console.log(`${this.name} PTY assumed ready for worktree ${worktreePath}`);
          resolve(ptyProcess);
        }
      }, 3000);
    });
  }

  abstract getSpawnArgs(options?: { interactive?: boolean; port?: number }): { command: string; args: string[]; env?: Record<string, string> };

  parseOutput?(output: string): { inputTokens?: number; outputTokens?: number; cost?: number } | null {
    // Default implementation - no output parsing
    return null;
  }

  async cleanup?(process: any): Promise<void> {
    // Default implementation - just kill the process
    if (process && typeof process.kill === 'function') {
      process.kill();
    }
  }

  // Helper methods for subclasses
  protected async runCommand(args: string[], timeoutMs: number = 10000): Promise<{ stdout: string; stderr: string; code: number }> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, args, {
        stdio: 'pipe',
        env: process.env as { [key: string]: string },
        shell: true // Use shell to properly resolve commands and handle shebangs
      });
      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr?.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        resolve({ stdout, stderr, code: code || 0 });
      });

      child.on('error', (error) => {
        reject(error);
      });

      // Timeout after specified milliseconds
      setTimeout(() => {
        child.kill();
        reject(new Error('Command timeout'));
      }, timeoutMs);
    });
  }

  protected parseVersion(output: string): string | undefined {
    // Common version patterns
    const versionPatterns = [
      /version\s+([^\s\n]+)/i,
      /v?(\d+\.\d+\.\d+[^\s]*)/,
      /(\d+\.\d+\.\d+)/
    ];

    for (const pattern of versionPatterns) {
      const match = output.match(pattern);
      if (match) {
        return match[1];
      }
    }

    return output.split('\n')[0]?.trim();
  }

  protected isReadyOutput(data: string, fullOutput: string): boolean {
    // Common patterns that indicate the agent is outputting something
    return data.includes(this.name.toLowerCase()) ||
           data.includes('error') ||
           data.includes('Error') ||
           data.includes('ready') ||
           data.includes('Starting');
  }

  protected isAgentReady(data: string, fullOutput: string): boolean {
    // Default implementation - look for agent name or sufficient output
    return fullOutput.toLowerCase().includes(this.name.toLowerCase()) ||
           fullOutput.length > 100;
  }
}