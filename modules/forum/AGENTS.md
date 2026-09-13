# Tuff Forum module entry

Read [root AGENTS](../../AGENTS.md), [forum module contract](../../docs/modules/forum.md) and [upstream guide](README.md).

This directory is the actual MIT-licensed Tuff Forum source, not a React reimplementation. It is an independent Nuxt/Vue/TuffEx package with its own Node >=26 and pnpm 11.24.0 lockfile. Use root `forum:*` commands. Keep the upstream style guard and its negative controls. This upstream revision has mock identity and browser-local data, not real authentication or server persistence; never treat them as security boundaries. See the central module contract for all project-specific rules.
