/**
 * Plug-ins in the app's words: the state of a plug-in a set uses, and what to do about it. The
 * three state colours are those of the samples (one palette, checked once); a state is told by
 * its icon and label, the colour only helps.
 */
import type { PluginState, PluginUseRow } from '@livesaver/ops'

export interface PluginLook {
  readonly label: string
  readonly icon: string
  readonly tone: string
  readonly colour: string
}

export const PLUGIN_STATE: Readonly<Record<PluginState, PluginLook>> = {
  installed: {
    label: 'Installed',
    icon: 'i-lucide-circle-check',
    tone: 'text-(--status-fine)',
    colour: 'var(--status-fine)',
  },
  // Works, but only while Live runs under Rosetta: something to act on, not a loss.
  rosetta: {
    label: 'Rosetta only',
    icon: 'i-lucide-cpu',
    tone: 'text-(--status-fixable)',
    colour: 'var(--status-fixable)',
  },
  missing: {
    label: 'Not installed',
    icon: 'i-lucide-triangle-alert',
    tone: 'text-(--status-missing)',
    colour: 'var(--status-missing)',
  },
  unknown: {
    label: 'Not known',
    icon: 'i-lucide-circle-help',
    tone: 'text-(--status-unknown)',
    colour: 'var(--status-unknown)',
  },
}

/** In the order a list sorts them: what needs attention first. */
export const PLUGIN_STATES: readonly PluginState[] = ['missing', 'rosetta', 'installed', 'unknown']

/** Whether livesaver can switch the sets from this VST2 plug-in to its installed VST3. */
export const canUpgrade = (use: PluginUseRow): boolean => Boolean(use.vst3?.verified)

/** What to do about a plug-in the sets use, most useful advice first. */
export function pluginAdvice(use: PluginUseRow): string[] {
  const advice: string[] = []
  const native = use.nativeAlternative
  if (use.state === 'unknown') {
    advice.push(
      'Whether it is installed is not known here: a page in a browser cannot see your plug-ins. Open the app with “livesaver web” to compare the sets with what is installed.',
    )
    return advice
  }
  if (use.state === 'missing') {
    advice.push(
      use.failedBundle
        ? `A bundle of this name is installed, but Live could not load it: ${use.failedBundle}. Reinstall it, or let Live scan the plug-ins again.`
        : `Live finds no ${use.format} plug-in with this id. A set that uses it opens with a placeholder until it is installed.`,
    )
  }
  if (use.state === 'rosetta')
    advice.push(
      'It contains Intel code only, so Live loads it only when Live itself runs under Rosetta.',
    )
  if (canUpgrade(use))
    advice.push(
      'Its VST3 is installed, and livesaver can switch the sets to it, keeping the sound: see Upgrade.',
    )
  else if (use.vst3)
    advice.push(
      `Its VST3 (“${use.vst3.name}”) is installed, but switching to it is not verified for this plug-in, so livesaver leaves it alone.`,
    )
  else if (native && use.state !== 'installed')
    advice.push(
      `It is installed as ${native.format} (“${native.name}”), which runs natively. Live does not switch formats by itself: replace the device in the sets, or install the ${use.format} version.`,
    )
  if (advice.length === 0) advice.push('Nothing to do: Live loads it.')
  return advice
}

/** The text a search over the plug-ins is matched against. */
export const useText = (use: PluginUseRow): string =>
  `${use.name} ${use.format} ${use.code} ${use.state}`
