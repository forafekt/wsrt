# @wsrt/di

A lightweight, strongly-typed Dependency Injection (DI) container for TypeScript and Deno (works in Node and browsers as well).

This container provides:

- Instance, factory, and singleton registrations
- Fully typed service resolution
- Async + sync resolution support
- Hierarchical container scoping
- Automatic disposal lifecycle management
- Introspection utilities
- Zero external dependencies
- Tiny and predictable runtime behavior

---

## 📋 Table of Contents

- [Features](#-features)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Core Concepts](#-core-concepts)
- [API Reference](#-api-reference)
- [Examples](#-examples)
- [Best Practices](#-best-practices)
- [Type Safety](#-type-safety)
- [Performance](#-performance)
- [Comparison](#-comparison)
- [License](#-license)

---

## ✨ Features

- ✅ Strong TypeScript inference
- ✅ Async dependency support
- ✅ Child containers / scoped resolution
- ✅ Lazy singleton instantiation
- ✅ Disposal lifecycle support
- ✅ Parent fallback resolution
- ✅ Runtime safety checks
- ✅ Extremely small footprint

---

## 📦 Installation
```bash
deno add jsr:@wsrt/di
```

### Deno

```ts
import { createContainer } from "jsr:@wsrt/di";
```
---

### Node / Bun / Browser

Works with any TypeScript runtime or bundler.

---

## 🚀 Quick Start

```ts
import { createContainer } from "jsr:@wsrt/di"

// Create a container
const container = createContainer();

// Register a config service
container.register("config", { port: 3000 });

// Register a server factory
container.registerFactory("server", (c) => {
  const config = c.resolve("config");
  return { start: () => console.log(config.port) };
});

// Resolve the server
const server = container.resolve("server");
server.start();
```
---

## 🧠 Core Concepts

### Registration Types

| Type      | Description                    |
| --------- | ------------------------------ |
| Instance  | Pre-created value              |
| Factory   | New instance every resolve     |
| Singleton | Lazily created once and cached |

---

## 📚 API Reference

---

### `createContainer()`

Creates a new DI container.

```ts
const container = createContainer();
```

You can optionally pass a parent container:

```ts
const child = createContainer(parent);
```

---

## 🧾 Registration

---

### `register(name, instance)`

Registers a pre-existing instance.

```ts
container.register("logger", new Logger());
```

---

### `registerFactory(name, factory)`

Registers a factory function.

Factory runs every time the service is resolved.

```ts
container.registerFactory("requestId", () => crypto.randomUUID());
```

---

### `registerSingleton(name, factory)`

Registers a lazily created singleton.

Factory runs once and is cached.

```ts
container.registerSingleton("database", () => new Database());
```

---

## 🔍 Resolution

---

### `resolve(name)`

Resolves a service synchronously.

```ts
const db = container.resolve("database");
```

⚠️ Throws if service is async.

---

### `resolveAsync(name)`

Resolves services that may return promises.

```ts
const db = await container.resolveAsync("database");
```

---

### `has(name)`

Checks if service exists locally or in parent containers.

```ts
if (container.has("database")) {
  // ...
}
```

---

## 🌳 Container Scoping

Containers support parent / child hierarchies.

### `createChild()`

Creates a child container that inherits parent services.

```ts
const root = createContainer();
const requestScope = root.createChild();
```

Child containers:

* Can override services
* Fallback to parent resolution
* Are ideal for request or tenant scoping

---

### `getParent()`

Returns the parent container if one exists.

---

### `getParentOrCurrent()`

Returns:

* Parent container if exists
* Otherwise current container

Useful when needing shared global dependencies.

---

## 🧹 Lifecycle & Disposal

---

### Disposable Interface

Services may implement:

```ts
interface DIDisposable {
  dispose(): void | Promise<void>;
}
```

---

### `container.dispose()`

Automatically disposes singleton or instance services that implement `dispose()`.

```ts
await container.dispose();
```

This is useful for:

* Database connections
* File handles
* Network sockets
* Resource pools

---

### `clear()`

Removes all registrations without calling `dispose()`.

---

## 🧾 Introspection

---

### `list()`

Returns all service keys including inherited ones.

```ts
console.log(container.list());
```

---

## 🧩 Strong Typing

You can define container service maps for full compile-time safety.

---

### Example

```ts
interface Services {
  logger: Logger;
  config: Config;
  database: Database;
}

const container = createContainer<Services>();

container.register("config", { port: 3000 });

const config = container.resolve("config"); // fully typed
```

---

## ⚡ Async Dependencies

Factories may return promises.

```ts
container.registerSingleton("db", async () => {
  return await Database.connect();
});

const db = await container.resolveAsync("db");
```

---

## 🏗️ Real World Pattern Example

---

### App Container

```ts
const app = createContainer();

app.registerSingleton("config", () => loadConfig());

app.registerSingleton("logger", () => new Logger());

app.registerSingleton("db", async (c) => {
  const config = c.resolve("config");
  return await Database.connect(config.dbUrl);
});
```

---

### Request Scope

```ts
function createRequestScope(appContainer: Container) {
  const scope = appContainer.createChild();

  scope.register("requestId", crypto.randomUUID());

  return scope;
}
```

---

## ⚠️ Singleton Safety Warning

If singleton factories depend on tenant or scoped data, a warning may be logged:

```
[DI] Singleton 'serviceName' depends on tenant — this is unsafe.
```

Singletons should generally depend only on global services.

---

## 🔄 Resolution Rules

Resolution follows:

1. Local container lookup
2. Parent container lookup
3. Error thrown if not found

---

## 🧪 Testing Example

```ts
const testContainer = createContainer();

testContainer.register("db", new MockDatabase());
```

---

## 📏 Design Goals

* Minimal runtime cost
* Maximum type safety
* Explicit lifecycle handling
* No decorators required
* Framework-agnostic
* Deno-first but universal

---

## ❓ When To Use

This container is ideal for:

* Backend services
* CLI tools
* Framework cores
* Multi-tenant apps
* Plugin systems
* Testing & mocking

---

## ❌ When Not To Use

You may not need DI if:

* Your app is very small
* You prefer functional composition only
* You require compile-time injection (e.g. Angular style)

---

## 🧠 Best Practices

### ✔ Prefer Singletons for Expensive Services

* Databases
* HTTP clients
* Loggers

---

### ✔ Use Child Containers for Scoped Data

* Requests
* Tenants
* Sessions

---

### ✔ Avoid Cross-Scope Singleton Dependencies

---

### ✔ Dispose Containers On Shutdown

```ts
await container.dispose();
```

---

## 🔒 Error Handling

The container throws explicit errors for:

* Missing services
* Async misuse (`resolve` vs `resolveAsync`)
* Usage after disposal

---

## 📊 Performance Notes

* Singleton creation is lazy
* Factory resolution has near-zero overhead
* Parent lookup is shallow and predictable

---

## 🧱 Architecture Overview

```
Container
 ├── Instance services
 ├── Factory services
 ├── Singleton cache
 ├── Parent reference
 └── Disposal manager
```

---

## 🛠️ Advanced Patterns

---

### Plugin Systems

```ts
function registerPlugin(container: Container) {
  container.registerFactory("plugin", () => new Plugin());
}
```

---

### Multi-Tenant Containers

```ts
const tenantContainer = app.createChild();
tenantContainer.register("tenantId", tenant.id);
```

---

## 📄 License

[MIT](LICENSE)
