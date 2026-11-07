import type { RouteGateOptions } from '../core/index';
import { VARIANTS_ENDPOINT } from '../core/variants';
import type { IterationTheme, MountIterationOptions } from '../core/types';
import { NOTES_ENDPOINT } from '../node/notes/handler';
import { UPDATE_ENDPOINT } from '../node/update/check';
import { readKnobs } from '../node/variants/store';

/**
 * What `isotone serve` hands `mountIteration` in its bundle.
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
  opts: { key?: string; rule?: RouteGateOptions; theme?: IterationTheme },
): MountIterationOptions {
  const knobs = readKnobs({ root: projectRoot }).length > 0;
  return {
    endpoint: `${origin}${NOTES_ENDPOINT}`,
    ...(knobs ? { variants: 'knobs' as const, variantsEndpoint: `${origin}${VARIANTS_ENDPOINT}` } : {}),
    updateEndpoint: `${origin}${UPDATE_ENDPOINT}`,
    key: opts.key ?? '',
    rule: opts.rule ?? {},
    theme: opts.theme,
  };
}
