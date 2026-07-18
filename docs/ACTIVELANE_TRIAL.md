# Activeline trial plan

Do not replace Activeline's orchestration in one change. Install packed alpha packages on a trial branch and keep the existing commands as the rollback path.

1. **Inspect only:** install CLI, config, and Vite plugin tarballs; add `wsrt.config.ts`; enable workspace discovery; run `validate`, `inspect --json`, and `workspace inspect` without starting anything.
2. **Workspace resolution:** compare aliases and package relationships with existing TypeScript/Vite configuration. Use `workspace check` before allowing `workspace sync` to write projections.
3. **Finite tasks:** model one deterministic build or generation task and compare outputs with the existing command.
4. **One Vite service:** declare one renderer/web node using the Vite provider, with loopback readiness and an explicit root. Keep its old start command available.
5. **Desktop composite system:** add renderer, main, preload, and Electron children; then server and registry services. Encode dependencies, readiness, continuous health, and shutdown ordering incrementally.
6. **Dashboard and MCP:** add only after lifecycle behavior is established. Keep dashboard on `127.0.0.1`; enable MCP mutations only for trusted clients.

At each phase, retain the previous scripts, compare `inspect --json` in CI, and roll back by removing the WSRT config/scripts and package entries. Do not run `workspace sync` or remove existing orchestration until its generated diff has been reviewed. The packed fixture in this repository is the template for installing local `.tgz` files before npm publication.
