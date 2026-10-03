<script setup lang="ts">
/** The landing page: what livesaver does, how, and the two ways to use it. */
import { REPOSITORY } from '~/utils/links'

const app = useAppUrl()

useSeoMeta({
  title: 'Your Ableton Live projects, complete again',
  description:
    'livesaver finds the samples your Ableton Live sets have lost, collects them into their projects, and shows which plug-ins are missing: for your whole library at once, with a review before and an undo after.',
  ogTitle: 'livesaver: your Ableton Live projects, complete again',
  ogDescription:
    'Find the samples your Live sets have lost, fix hundreds of projects at once, and undo any of it. Free and open source.',
})

const steps = [
  {
    icon: 'i-lucide-scan-search',
    title: '1. Scan',
    description:
      'One scan reads every set of your library, its samples and its plug-ins. 876 sets take about 13 seconds, and a scan changes nothing.',
  },
  {
    icon: 'i-lucide-list-checks',
    title: '2. Review',
    description:
      'You see what a fix would do before anything is written: which sets are rewritten, which files are copied, which matches are uncertain.',
  },
  {
    icon: 'i-lucide-wrench',
    title: '3. Fix, and undo',
    description:
      'livesaver does what Collect All and Save does, for every project at once. Each set is backed up first, and a fix can be taken back, also weeks later.',
  },
]

const samples = [
  {
    icon: 'i-lucide-fingerprint',
    title: 'Found by what they are',
    description:
      'A set remembers the size and a checksum of every sample. livesaver computes the checksum as Live does, and finds a file wherever it lies now and whatever it is called.',
  },
  {
    icon: 'i-lucide-folder-input',
    title: 'Collected into the project',
    description:
      'Samples from elsewhere are copied into the project, and the set points at the copies: the project is complete, and stays complete when you move it.',
  },
  {
    icon: 'i-lucide-circle-help',
    title: 'Uncertain matches are yours to decide',
    description:
      'Where a file fits by name and place but its fingerprint does not confirm it, livesaver says so. Leave those out with one switch.',
  },
]

const missing = [
  {
    icon: 'i-lucide-package',
    title: 'A pack, an expansion, an old drive',
    description:
      'What no folder had is grouped by where it came from: an Ableton pack, a Native Instruments expansion, an older User Library, a drive that is gone.',
  },
  {
    icon: 'i-lucide-signpost',
    title: 'Each with what to do',
    description:
      'Install the pack again, plug in the drive, add the folder that has the files. Then scan again: what the folder has is found.',
  },
]

const plugins = [
  {
    icon: 'i-lucide-triangle-alert',
    title: 'Missing, before you open the set',
    description:
      'Every plug-in your sets use, compared by format and id with what is installed, the way Live does it.',
  },
  {
    icon: 'i-lucide-cpu',
    title: 'Rosetta only',
    description:
      'Which plug-ins still contain only Intel code, which sets depend on them, and whether a native version is installed in another format.',
  },
  {
    icon: 'i-lucide-circle-arrow-up',
    title: 'VST2 to VST3',
    description:
      'Switch your sets from a VST2 plug-in to its VST3, keeping the sound, for plug-ins where that is verified. Reviewed first, and undone if you wish.',
  },
]

const history = [
  {
    icon: 'i-lucide-history',
    title: 'Every run, with every step',
    description:
      'What was asked, which sets were rewritten, which files were copied, and the reports to download.',
  },
  {
    icon: 'i-lucide-undo-2',
    title: 'An undo that respects your work',
    description:
      'Sets go back to what they were, copies go to the Trash. A set you changed since is left alone.',
  },
]

const careful = [
  {
    icon: 'i-lucide-pencil-line',
    title: 'Only the bytes that must change',
    description:
      'A set is never read into a model and written out again. A reference is replaced; everything else stays exactly as Live saved it.',
  },
  {
    icon: 'i-lucide-archive',
    title: 'A backup beside every set',
    description:
      'In the project’s Backup folder, named as Live names its own. The original is kept by livesaver as well, for the undo.',
  },
  {
    icon: 'i-lucide-shield-check',
    title: 'Never while Live runs',
    description:
      'A set that is open in Live is not rewritten under it. livesaver checks, and waits for you to quit Live.',
  },
  {
    icon: 'i-lucide-trash-2',
    title: 'Nothing is deleted',
    description: 'What an undo removes goes to the Trash. Nothing is ever removed for good.',
  },
  {
    icon: 'i-lucide-lock',
    title: 'Nothing leaves your computer',
    description:
      'No account, no statistics, no requests to any server. The app talks only to the livesaver on your own Mac.',
  },
  {
    icon: 'i-lucide-flask-conical',
    title: 'Tested on real sets',
    description:
      'Against sets that Live itself saved, and read-only on a real library: 13,000 Live files read and written back without a changed byte.',
  },
]

/** Commands with what they do: the note first, as a comment stands above its line. */
const commands = [
  ['what is missing, what a fix would do', 'livesaver doctor ~/Music/Projects'],
  ['the fix, for every project', 'livesaver collect ~/Music/Projects --apply'],
  ['take it back', 'livesaver undo <run>'],
  ['missing, Rosetta only, unused', 'livesaver plugins audit ~/Music/Projects'],
  ['search your sets', 'livesaver find plugin:serum bpm:120..128'],
] as const
</script>

<template>
  <div>
    <UPageHero
      title="Your Live projects, complete again"
      description="livesaver finds the samples your Ableton Live sets have lost, collects them into their projects, and shows which plug-ins are missing: for your whole library at once, without opening Live. Every change is shown first, backed up, and can be undone."
      :links="[
        { label: 'Open the app', to: app, external: true, size: 'xl' },
        {
          label: 'Get livesaver',
          to: '/docs/guide/getting-started',
          size: 'xl',
          color: 'neutral',
          variant: 'subtle',
          trailingIcon: 'i-lucide-arrow-right',
        },
      ]"
    >
      <template #headline>
        <UBadge color="neutral" variant="subtle" size="lg" class="rounded-full">
          Free and open source · for macOS
        </UBadge>
      </template>
      <AppShot
        name="overview"
        alt="The overview of livesaver after a scan: 6 of 21 sets are complete, 11 more will be after a fix, and 8 samples stay missing, listed by where they came from"
        eager
      />
      <p class="mt-6 text-center text-sm text-muted">
        The app in your browser scans and shows everything. To fix, run livesaver on your Mac.
      </p>
    </UPageHero>

    <UPageSection
      title="Three steps, and nothing happens behind your back"
      description="“Media files are missing” in one set is a nuisance. In a library that has moved between drives and computers, it is hundreds of sets. livesaver handles them all at once, and shows you everything first."
      :features="steps"
    />

    <UPageSection
      title="Missing samples, found again"
      description="Live looks for a sample where the set says it was. livesaver looks for the sample itself."
      orientation="horizontal"
      :features="samples"
      :links="[
        {
          label: 'How fixing works',
          to: '/docs/guide/samples',
          color: 'neutral',
          variant: 'subtle',
          trailingIcon: 'i-lucide-arrow-right',
        },
      ]"
    >
      <AppShot
        name="review"
        alt="The review before a fix: 13 sets rewritten, 18 references repointed, 16 files copied, with the projects it applies to"
      />
    </UPageSection>

    <UPageSection
      title="What stays missing, and what to do about it"
      description="A fix can only find what is in the folders it searches. The rest is not a long list of file names, but a short list of sources."
      orientation="horizontal"
      reverse
      :features="missing"
      :links="[
        {
          label: 'When samples stay missing',
          to: '/docs/guide/missing',
          color: 'neutral',
          variant: 'subtle',
          trailingIcon: 'i-lucide-arrow-right',
        },
      ]"
    >
      <AppShot
        name="missing"
        alt="Missing samples grouped by source: a Native Instruments expansion, a folder on an old drive, an Ableton pack, each with advice"
      />
    </UPageSection>

    <UPageSection
      title="Plug-ins: know before you open the set"
      description="Live finds a plug-in by its format and its id, never by its name. So does livesaver."
      orientation="horizontal"
      :features="plugins"
      :links="[
        {
          label: 'More about plug-ins',
          to: '/docs/guide/plugins',
          color: 'neutral',
          variant: 'subtle',
          trailingIcon: 'i-lucide-arrow-right',
        },
      ]"
    >
      <AppShot
        name="plugins"
        alt="The plug-ins the sets use, each with its format and state: not installed, Rosetta only, or installed"
      />
    </UPageSection>

    <UPageSection
      title="A history you can take back"
      description="Everything livesaver changes is written down as a run, with the original of every set it rewrote."
      orientation="horizontal"
      reverse
      :features="history"
      :links="[
        {
          label: 'History and undo',
          to: '/docs/guide/history',
          color: 'neutral',
          variant: 'subtle',
          trailingIcon: 'i-lucide-arrow-right',
        },
      ]"
    >
      <AppShot
        name="history"
        alt="The history: an upgrade of plug-ins and two fixes of today, each with its undo and its details"
      />
    </UPageSection>

    <UPageSection
      title="Careful with your work"
      description="livesaver edits the files your music lives in. These are the rules it keeps."
      :links="[
        {
          label: 'How your work is kept safe',
          to: '/docs/guide/safety',
          color: 'neutral',
          variant: 'subtle',
          trailingIcon: 'i-lucide-arrow-right',
        },
      ]"
    >
      <UPageGrid>
        <UPageCard
          v-for="rule in careful"
          :key="rule.title"
          :icon="rule.icon"
          :title="rule.title"
          :description="rule.description"
          variant="subtle"
        />
      </UPageGrid>
    </UPageSection>

    <UPageSection
      title="Two ways to use it"
      description="The same app, in two places. What it cannot do where it runs is said there, not hidden."
    >
      <div class="grid gap-6 lg:grid-cols-2">
        <UPageCard
          icon="i-lucide-globe"
          title="In your browser"
          description="Nothing to install. Hand the page your project folder and your sample folders; it reads them where they are."
          variant="outline"
        >
          <ul class="mt-2 space-y-1.5 text-sm" aria-label="In your browser">
            <li class="flex gap-2">
              <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-(--status-fine)" />
              Scans samples and plug-ins, with all tables and reports
            </li>
            <li class="flex gap-2">
              <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-(--status-fine)" />
              Chrome, Safari, Firefox
            </li>
            <li class="flex gap-2">
              <UIcon name="i-lucide-minus" class="mt-0.5 size-4 shrink-0 text-muted" />
              Reads only: no fix, no undo, and it cannot see what is installed
            </li>
          </ul>
          <template #footer>
            <UButton :to="app" external label="Open the app" />
          </template>
        </UPageCard>
        <UPageCard
          icon="i-lucide-monitor"
          title="On your Mac"
          description="With livesaver behind it, the app reads your disk itself and can write. One command opens it."
          variant="outline"
        >
          <ul class="mt-2 space-y-1.5 text-sm" aria-label="On your Mac">
            <li class="flex gap-2">
              <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-(--status-fine)" />
              Everything the browser does
            </li>
            <li class="flex gap-2">
              <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-(--status-fine)" />
              Fixes all projects, a selection or one, with backups and undo
            </li>
            <li class="flex gap-2">
              <UIcon name="i-lucide-check" class="mt-0.5 size-4 shrink-0 text-(--status-fine)" />
              Knows your installed plug-ins, and upgrades VST2 to VST3
            </li>
          </ul>
          <template #footer>
            <UButton
              to="/docs/guide/getting-started"
              label="Get livesaver"
              color="neutral"
              variant="subtle"
              trailing-icon="i-lucide-arrow-right"
            />
          </template>
        </UPageCard>
      </div>
    </UPageSection>

    <UPageSection
      title="And a command line"
      description="Everything the app does, the livesaver command does too, and more: project status as Finder tags, a catalog of your sets to search, and codemods that change many sets at once."
      orientation="horizontal"
      :links="[
        {
          label: 'The command line',
          to: '/docs/guide/command-line',
          color: 'neutral',
          variant: 'subtle',
          trailingIcon: 'i-lucide-arrow-right',
        },
      ]"
    >
      <ul
        class="min-w-0 space-y-3 rounded-lg bg-elevated/50 p-5 font-mono text-sm ring ring-default"
        aria-label="Examples of commands"
      >
        <li v-for="[ note, command ] in commands" :key="command">
          <span class="block text-muted"># {{ note }}</span>
          <span class="block break-words text-highlighted">{{ command }}</span>
        </li>
      </ul>
    </UPageSection>

    <UPageSection
      title="What we learned about Live’s files"
      description="How a set stores a sample, what Live’s checksum is, how plug-ins are told apart, where Live keeps its own lists: written down with sources, for anyone who builds tools for Live."
      :links="[
        { label: 'File formats', to: '/docs/format', color: 'neutral', variant: 'subtle' },
        {
          label: 'The source on GitHub',
          to: REPOSITORY,
          target: '_blank',
          color: 'neutral',
          variant: 'ghost',
          icon: 'i-simple-icons-github',
        },
      ]"
    />

    <UPageCTA
      title="See what your library is missing"
      description="A scan takes seconds and changes nothing."
      variant="subtle"
      class="rounded-none"
      :links="[
        { label: 'Open the app', to: app, external: true, size: 'xl' },
        {
          label: 'Read the guide',
          to: '/docs/guide/getting-started',
          size: 'xl',
          color: 'neutral',
          variant: 'outline',
        },
      ]"
    />
  </div>
</template>
