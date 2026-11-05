import { expect, it } from "vitest";
import readme from "../../README.md?raw";
import configSource from "../../wrangler.jsonc?raw";
import playwright from "../../playwright.config.ts?raw";
import worker from "../../src/worker.ts?raw";

const examples = import.meta.glob("../../wrangler.example.jsonc", { query: "?raw", import: "default", eager: true });
const config = JSON.parse(configSource.replace(/^\s*\/\/.*$/gm, ""));
const run = readme.split("## Run it")[1]?.split(/\n## /)[0] || "";

it("serves on the port used by the browser tests", () => {
  const port = Number(playwright.match(/http:\/\/127\.0\.0\.1:(\d+)/)![1]);
  expect(config.dev?.port).toBe(port);
  expect(config.dev?.ip).toBe("127.0.0.1");
});

it("documents the complete local setup and required bindings", () => {
  for (const step of ["vendor_bryntum.py", "playwright install", "8795"]) expect(run).toContain(step);
  const env = worker.match(/export interface Env \{([\s\S]*?)\n\}/)![1];
  const keys = [...env.matchAll(/^\s*(\w+):/gm)].map((match) => match[1]);
  expect(keys.length).toBeGreaterThan(0);
  for (const key of keys) expect(run, `Run it must explain ${key}`).toContain(key);
});

it("ships an example without any hosted ids", () => {
  const example = String(Object.values(examples)[0] || "");
  expect(example).toContain("<your account id>");
  expect(example).toContain("<your KV namespace id>");
  expect(example).toContain("<your D1 database id>");
  for (const id of [config.account_id, ...config.kv_namespaces.map((binding: { id: string }) => binding.id), ...config.d1_databases.map((binding: { database_id: string }) => binding.database_id)]) {
    expect(example).not.toContain(id);
  }
});
