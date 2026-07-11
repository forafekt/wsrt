import {
  assert,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "jsr:@std/assert@1.0.16";

import DIContainer, {
  type Container,
  createContainer,
  type DIDisposable,
  type DIServiceFactory,
} from "./src/mod.ts";

/* ───────────────────────────────── Helpers ───────────────────────────────── */

function captureWarnings(fn: () => void | Promise<void>): string[] {
  const warnings: string[] = [];
  const original = console.warn;

  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(" "));
  };

  try {
    const result = fn();
    if (result instanceof Promise) {
      return [] as unknown as string[];
    }
    return warnings;
  } finally {
    console.warn = original;
  }
}

function snapshot(container: Container): string {
  const lines: string[] = [];

  function walk(c: Container, depth = 0) {
    const indent = "  ".repeat(depth);
    lines.push(`${indent}- container`);
    for (const key of c.list()) {
      lines.push(`${indent}  • ${String(key)}`);
    }
    const parent = c.getParent();
    if (parent) walk(parent, depth + 1);
  }

  walk(container);
  const content = lines.join("\n");
  return content;
}

function randomKey(i: number) {
  return `svc_${i}_${Math.random().toString(36).slice(2, 6)}`;
}

/* ───────────────────────────────── Registration & Resolution ───────────────────────────────── */

Deno.test("register + resolve instance", () => {
  const c = new DIContainer();
  c.register("value", 123);

  assertEquals(c.resolve("value"), 123);
});

Deno.test("factory returns new instance each time", () => {
  const c = new DIContainer();

  c.registerFactory("obj", () => ({ id: Math.random() }));

  const a = c.resolve<{ id: number }>("obj");
  const b = c.resolve<{ id: number }>("obj");

  assertNotEquals(a.id, b.id);
});

Deno.test("singleton returns same instance", () => {
  const c = new DIContainer();
  let calls = 0;

  c.registerSingleton("s", () => {
    calls++;
    return { value: 42 };
  });

  const a = c.resolve("s");
  const b = c.resolve("s");

  assertEquals(a, b);
  assertEquals(calls, 1);
});

/* ───────────────────────────────── Async Enforcement ───────────────────────────────── */

Deno.test("resolveAsync resolves async factory", async () => {
  const c = new DIContainer();
  c.registerFactory("async", async () => "ok");

  const value = await c.resolveAsync("async");
  assertEquals(value, "ok");
});

Deno.test("resolve throws when resolving async factory synchronously", () => {
  const c = new DIContainer();
  c.registerFactory("async", async () => "nope");

  assertThrows(
    () => c.resolve("async"),
    Error,
    "Use resolveAsync",
  );
});

/* ───────────────────────────────── Errors & has() ───────────────────────────────── */

Deno.test("resolving missing service throws", () => {
  const c = new DIContainer();

  assertThrows(
    () => c.resolve("missing"),
    Error,
    "Service not found",
  );
});

Deno.test("has() checks local and parent services", () => {
  const parent = new DIContainer();
  parent.register("a", 1);

  const child = parent.createChild();

  assert(child.has("a"));
  assert(!child.has("b"));
});

/* ───────────────────────────────── Scoping & Overrides ───────────────────────────────── */

Deno.test("child resolves parent services", () => {
  const parent = new DIContainer();
  parent.register("x", 10);

  const child = parent.createChild();

  assertEquals(child.resolve("x"), 10);
});

Deno.test("child overrides parent service", () => {
  const parent = new DIContainer();
  parent.register("x", 1);

  const child = parent.createChild();
  child.register("x", 2);

  assertEquals(child.resolve("x"), 2);
  assertEquals(parent.resolve("x"), 1);
});

Deno.test("list() merges parent and child services", () => {
  const parent = new DIContainer();
  parent.register("a", 1);
  parent.register("b", 2);

  const child = parent.createChild();
  child.register("c", 3);

  const list = child.list().sort();
  assertEquals(list, ["a", "b", "c"]);
});

/* ───────────────────────────────── Warnings ───────────────────────────────── */

Deno.test("registerSingleton warns when dependsOn is declared", () => {
  const c = new DIContainer();

  const factory: DIServiceFactory<number, any> = () => 1;
  factory.dependsOn = ["a", "b"];

  const warnings = captureWarnings(() => {
    c.registerSingleton("s", factory);
  });

  assertEquals(warnings.length, 1);
  assert(warnings[0].includes("depends on"));
});

Deno.test("resolving singleton from child container warns", () => {
  const parent = new DIContainer();
  parent.registerSingleton("s", () => ({ value: 1 }));

  const child = parent.createChild();

  const warnings = captureWarnings(() => {
    child.resolve("s");
  });

  assertEquals(warnings.length, 1);
  assert(warnings[0].includes("child container"));
});

/* ───────────────────────────────── Disposal ───────────────────────────────── */

Deno.test("dispose() calls dispose on singleton services", async () => {
  let disposed = false;

  class Resource implements DIDisposable {
    dispose() {
      disposed = true;
    }
  }

  const c = new DIContainer();
  c.registerSingleton("r", () => new Resource());

  c.resolve("r");
  await c.dispose();

  assert(disposed);
});

Deno.test("dispose() is idempotent", async () => {
  const c = new DIContainer();
  await c.dispose();
  await c.dispose();
});

Deno.test("container throws if used after dispose", async () => {
  const c = new DIContainer();
  await c.dispose();

  assertThrows(
    () => c.register("x", 1),
    Error,
    "Container has been disposed",
  );
});

/* ───────────────────────────────── clear() ───────────────────────────────── */

Deno.test("clear() removes all services", () => {
  const c = new DIContainer();
  c.register("a", 1);
  c.register("b", 2);

  c.clear();

  assertEquals(c.list().length, 0);
});

/* ───────────────────────────────── Snapshot Visualization ───────────────────────────────── */

Deno.test("snapshot visualization is stable", () => {
  const root = new DIContainer();
  root.register("a", 1);
  root.registerSingleton("b", () => 2);

  const child = root.createChild();
  child.register("c", 3);

  const snap = snapshot(child);

  assertEquals(
    snap,
    `
- container
  • c
  • a
  • b
  - container
    • a
    • b
`.trim(),
  );
});

/* ───────────────────────────────── Fuzz / Property Tests ───────────────────────────────── */

Deno.test("fuzz: singleton always returns same instance", () => {
  const c = new DIContainer();

  for (let i = 0; i < 20; i++) {
    const key = randomKey(i);
    c.registerSingleton(key, () => ({ id: key }));
  }

  for (const key of c.list()) {
    const a = c.resolve(key);
    const b = c.resolve(key);
    assertEquals(a, b);
  }
});

Deno.test("fuzz: factory never caches instances", () => {
  const c = new DIContainer();

  for (let i = 0; i < 10; i++) {
    const key = randomKey(i);
    c.registerFactory(key, () => ({ n: Math.random() }));
  }

  for (const key of c.list()) {
    const a = c.resolve(key) as { n: number };
    const b = c.resolve(key) as { n: number };
    assertNotEquals(a.n, b.n);
  }
});

Deno.test("fuzz: child overrides never affect parent", () => {
  const parent = new DIContainer();
  parent.register("shared", { value: 1 });

  for (let i = 0; i < 5; i++) {
    const child = parent.createChild();
    child.register("shared", { value: i });

    assertEquals(child.resolve<{ value: number }>("shared").value, i);
    assertEquals(parent.resolve<{ value: number }>("shared").value, 1);
  }
});

/* ───────────────────────────────── Factory Helper ───────────────────────────────── */

Deno.test("createContainer() returns functional container", () => {
  const c = createContainer();
  c.register("x", 99);

  assertEquals(c.resolve("x"), 99);
});
