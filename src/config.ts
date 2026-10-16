// Copyright 2026 Scrakk Studio
// SPDX-License-Identifier: Apache-2.0
// Licencia completa en LICENSE (Apache License 2.0).

/**
 * SEF tooling — convenciones centralizadas.
 *
 * Única fuente de verdad para el layout v2 de un paquete. El core (loader)
 * y las herramientas de autor comparten estas constantes vía este archivo
 * y su espejo en docs/extensions/sef.md.
 */

export const SEF = {
  /** Nombre del manifest dentro del paquete. */
  MANIFEST: 'manifest.json',
  /** Carpeta de código compilado. */
  DIST: 'dist',
  /** Entry del bundle compilado. */
  ENTRY: 'dist/modules.js',
  /** Data por tipo (layout v2). */
  THEMES_DIR: 'themes',
  ICONS_DIR: 'icons',
  PRODUCT_ICONS_DIR: 'productIcons',
  LSP_DIR: 'lsp',
  /** Escenas de eventos (`contributes.events` → `path`). */
  EVENTS_DIR: 'events',
  /** Recursos del paquete (audio de eventos, imágenes…). */
  ASSETS_DIR: 'assets',
  /** Extensión de paquete instalable. */
  EXTENSION_EXT: '.sef'
} as const

/** Id válido de extensión/server (mismo criterio que main al instalar). */
export const ID_RE = /^[a-z0-9][a-z0-9._-]*$/i

/**
 * Módulos que el IDE le PRESTA al bundle: nunca se empaquetan.
 *
 * Si se empaquetaran, la extensión se quedaría con su PROPIA copia de React (los
 * hooks no compartirían el dispatcher del IDE) y —peor— el build de un panel que
 * usa los hooks documentados (`@features/layout`) fallaba directamente con
 * `Could not resolve "@features/layout"`, porque no era un specifier externo.
 *
 * El loader del IDE reescribe estos specifiers a los módulos reales de la app
 * (ver `runtime/bridge` y `loader/externals` en BorealChat).
 */
export const RUNTIME_EXTERNALS = [
  'react',
  'react-dom',
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@features/layout'
] as const

/** Rutas de código (componentes) referenciables desde contributes. */
export function collectCodePaths(manifest: Record<string, unknown>): string[] {
  const contributes = (manifest.contributes ?? {}) as Record<string, unknown>
  const paths: string[] = []

  const push = (value: unknown): void => {
    if (typeof value === 'string') paths.push(value)
  }

  for (const panel of (contributes.panels as Array<Record<string, unknown>> | undefined) ?? []) {
    push(panel?.component)
  }
  for (const button of (contributes.activityBar as Array<Record<string, unknown>> | undefined) ?? []) {
    push(button?.icon)
  }
  for (const tab of (contributes.centerTabs as Array<Record<string, unknown>> | undefined) ?? []) {
    push(tab?.component)
    push(tab?.icon)
  }
  return [...new Set(paths)]
}
