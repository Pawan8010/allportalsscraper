import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { config } from "../config/env";

export class CurlSession {
  private constructor(
    private readonly directory: string,
    private readonly cookieJar: string
  ) {}

  static async create(prefix: string): Promise<CurlSession> {
    const directory = await mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
    return new CurlSession(directory, path.join(directory, "cookies.txt"));
  }

  async get(url: string): Promise<string> {
    return this.request(url, "GET");
  }

  async post(url: string, body: string, headers: Record<string, string> = {}): Promise<string> {
    return this.request(url, "POST", body, headers);
  }

  private async request(
    url: string,
    method: "GET" | "POST",
    body?: string,
    headers: Record<string, string> = {}
  ): Promise<string> {
    const outputPath = path.join(this.directory, `response-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
    const curl = process.platform === "win32" ? "curl.exe" : "curl";
    const timeoutSeconds = String(Math.ceil(config.scraperTimeoutMs / 1000));
    const args = [
      "-sS",
      "-L",
      "--connect-timeout",
      timeoutSeconds,
      "--max-time",
      timeoutSeconds,
      "-A",
      config.scraperUserAgent,
      "-c",
      this.cookieJar,
      "-b",
      this.cookieJar,
      "-o",
      outputPath,
      "-w",
      "%{http_code}",
    ];
    if (method === "POST") {
      args.push("-X", "POST", "--data-raw", body ?? "");
    }
    for (const [name, value] of Object.entries(headers)) {
      args.push("-H", `${name}: ${value}`);
    }
    args.push(url);

    const statusCode = await new Promise<string>((resolve, reject) => {
      execFile(
        curl,
        args,
        { timeout: config.scraperTimeoutMs + 5_000, maxBuffer: 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message));
            return;
          }
          resolve(stdout.trim());
        }
      );
    });

    if (!/^2\d\d$/.test(statusCode)) {
      throw new Error(`Portal returned HTTP ${statusCode || "unknown"} for ${url}`);
    }

    return readFile(outputPath, "utf8");
  }

  async dispose(): Promise<void> {
    await rm(this.directory, { recursive: true, force: true });
  }
}
