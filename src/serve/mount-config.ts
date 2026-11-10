import type { ExperimentFlags } from '../core/experiments';
import type { RouteGateOptions } from '../core/routes';
import { VARIANTS_ENDPOINT } from '../core/variants';
import type { IsotoneTheme, MountIsotoneOptions } from '../core/types';
import { NOTES_ENDPOINT } from '../node/notes/handler';
import { UPDATE_ENDPOINT } from '../node/update/check';
import { resolveExperiments } from '../node/experiments';
import { readKnobs } from '../node/variants';

/**
 * What `isotone serve` hands `mountIsotone` in its bundle.
 *
 * Knobs only: file variants need a bundler to swap modules, which a script tag
 * on another dev server does not have. So the panel gets a Variants tool only
 * when `.isotone/knobs.json` holds valid knobs, and its empty list then asks
 * for knobs rather than variants. The bundle is never cached, so reloading the
 * page after the first knob is written brings the tool in.
 */
export function serveMountOptions(
  origin: string,
  projectRoot: string,
  opts: { key?: string; rule?: RouteGateOptions; theme?: IsotoneTheme; experimental?: ExperimentFlags },
): MountIsotoneOptions {
  const knobs = readKnobs({ root: projectRoot }).length > 0;
  // Read with every bundle, like the knobs: a flag set from the command line needs a reload, not a restart.
  const experimental = resolveExperiments(projectRoot, opts.experimental);
  return {
    endpoint: `${origin}${NOTES_ENDPOINT}`,
    ...(knobs ? { variants: 'knobs' as const, variantsEndpoint: `${origin}${VARIANTS_ENDPOINT}` } : {}),
    updateEndpoint: `${origin}${UPDATE_ENDPOINT}`,
    key: opts.key ?? '',
    rule: opts.rule ?? {},
    theme: opts.theme,
    ...(Object.keys(experimental).length ? { experimental } : {}),
  };
}
