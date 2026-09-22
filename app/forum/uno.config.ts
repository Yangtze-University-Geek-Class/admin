import { fileURLToPath } from 'node:url'
import { defineConfig, presetIcons, presetWind3 } from 'unocss'
import curation from './content/curation.json'
import { tuffexIconClasses } from './scripts/tuffex-icon-classes.mjs'

const iconClassesScript = fileURLToPath(
  new URL('./scripts/tuffex-icon-classes.mjs', import.meta.url),
)
const curationFile = fileURLToPath(new URL('./content/curation.json', import.meta.url))

// Category icons in the read-only snapshot arrive as runtime data (the
// projection emits i-carbon-archive / i-carbon-forum; content/curation.json
// names the rest), so the scanner never sees them. List them explicitly or the
// category picker renders empty tiles.
const snapshotIconClasses = [
  'i-carbon-archive',
  'i-carbon-forum',
  curation.archive.icon,
  ...curation.categories.map(category => category.icon),
  ...Object.values(curation.categoryPatches as Record<string, { icon?: string }>).flatMap(patch => (patch.icon ? [patch.icon] : [])),
]

export default defineConfig({
  presets: [
    presetWind3(),
    presetIcons({ scale: 1.2 }),
  ],

  rules: [
    [/^sidebar-tuned$/, () => `
      .sidebar-tuned .tx-bui-sidebar-nav__label { font-size: 14px !important; }
      .sidebar-tuned .tx-bui-sidebar-nav__group-label { font-size: 12px !important; font-weight: 600 !important; }
      .sidebar-tuned .tx-bui-sidebar-nav__row { padding-top: 7px !important; padding-bottom: 7px !important; gap: 10px !important; }
      .sidebar-tuned .tx-bui-sidebar-nav__icon { font-size: 16px !important; width: 1.25rem !important; height: 1.25rem !important; }
    `],
  ],

  // Tuffex renders its own icons as `<i class="i-carbon-…">` from inside
  // node_modules, which UnoCSS never scans. Collect those classes from the
  // published dist so the rules exist regardless of what our templates use.
  safelist: [...new Set([...tuffexIconClasses(), ...snapshotIconClasses, 'sidebar-tuned'])],

  content: {
    pipeline: {
      include: [
        // UnoCSS defaults
        /\.(vue|svelte|[jt]sx|mdx?|astro|elm|php|phtml|html)($|\?)/,
        // Icon names kept in data modules (category icons, notification types).
        /app\/.*\.ts($|\?)/,
      ],
    },
  },

  // Re-run this config when the scanner or the curated icon list changes;
  // UnoCSS only watches the config file itself otherwise.
  configDeps: [iconClassesScript, curationFile],
})
