<script setup lang="ts">
/**
 * The steps on a Mac: Live's content lies inside the app, where no folder dialog leads, and a
 * browser says odd things about it. The pictures are drawn here (they follow the theme, and
 * show no one's computer); the steps say the same in words.
 */
const OTHER_APPS = ['Calendar', 'Mail', 'Notes']
</script>

<template>
  <div>
    <ol class="space-y-6" data-testid="live-guide">
      <li class="grid gap-3 sm:grid-cols-2 sm:gap-5">
        <div>
          <h3 class="font-semibold text-highlighted">
            <span class="me-1.5 text-muted">1</span>Open your Applications folder
          </h3>
          <p class="mt-1 text-sm text-muted">
            In Finder: <span class="text-default">Go › Applications</span>, or press
            <UKbd value="shift" /> <UKbd value="meta" /> <UKbd value="A" />. Put the window beside
            this one.
          </p>
        </div>
        <!-- A Finder window, with the app that is meant. -->
        <div
          class="rounded-lg border border-default bg-elevated/40 text-xs"
          aria-hidden="true"
          data-testid="guide-picture"
        >
          <div class="flex items-center gap-1.5 border-b border-default px-3 py-2">
            <span v-for="dot in 3" :key="dot" class="size-2.5 rounded-full bg-accented" />
            <span class="ms-2 font-medium text-highlighted">Applications</span>
          </div>
          <ul class="space-y-0.5 p-1.5">
            <li
              class="flex items-center gap-2 rounded-md bg-elevated px-2 py-1.5 ring-1 ring-accented"
            >
              <span
                class="flex h-5 w-7 items-center justify-center rounded bg-inverted text-[9px] font-semibold text-inverted"
                >Live</span
              >
              <span class="font-medium text-highlighted">Ableton Live 12 Suite</span>
            </li>
            <li
              v-for="app in OTHER_APPS"
              :key="app"
              class="flex items-center gap-2 px-2 py-1.5 text-dimmed"
            >
              <span class="h-5 w-7 rounded bg-accented/60" />
              {{ app }}
            </li>
          </ul>
        </div>
      </li>

      <li class="grid gap-3 sm:grid-cols-2 sm:gap-5">
        <div>
          <h3 class="font-semibold text-highlighted">
            <span class="me-1.5 text-muted">2</span>Drag the app onto “Sample folders”
          </h3>
          <p class="mt-1 text-sm text-muted">
            Take <span class="text-default">Ableton Live</span> with the mouse and drop it on the
            list of sample folders on this page. Only its Core Library is read.
          </p>
          <p class="mt-2 text-sm text-muted">
            Or drag its <code class="text-xs">Contents</code> folder: right-click the app, choose
            <span class="text-default">Show Package Contents</span>, and drag
            <code class="text-xs">Contents</code>
            here.
          </p>
          <p class="mt-2 text-sm text-muted">
            “Add folder” cannot open an app. In its dialog, press
            <UKbd value="meta" /> <UKbd value="shift" /> <UKbd value="G" /> and type the path of the
            folder:
            <code class="text-xs">/Applications/<wbr>Ableton Live 12 Suite.app/<wbr>Contents</code>
          </p>
        </div>
        <!-- The app on its way into the list, and the other way in: the menu of a right-click. -->
        <div class="space-y-2 text-xs" aria-hidden="true" data-testid="guide-picture">
          <div class="flex items-center gap-2">
            <span
              class="flex -rotate-3 items-center gap-2 rounded-md bg-elevated px-2 py-1.5 shadow-md ring-1 ring-accented"
            >
              <span
                class="flex h-5 w-7 items-center justify-center rounded bg-inverted text-[9px] font-semibold text-inverted"
                >Live</span
              >
              <span class="font-medium text-highlighted">Ableton Live 12 Suite</span>
            </span>
            <UIcon name="i-lucide-arrow-right" class="size-5 shrink-0 text-muted" />
            <span
              class="flex-1 rounded-lg border-2 border-dashed border-accented px-3 py-3 text-center"
            >
              <span class="block font-medium text-highlighted">Sample folders</span>
              <span class="text-muted">drop it here</span>
            </span>
          </div>
          <div class="flex items-start gap-2 pt-1">
            <div class="w-44 rounded-lg border border-default bg-default p-1 shadow-sm">
              <div class="px-2 py-1 text-muted">Open</div>
              <div class="rounded bg-inverted px-2 py-1 font-medium text-inverted">
                Show Package Contents
              </div>
              <div class="px-2 py-1 text-muted">Move to Trash</div>
            </div>
            <UIcon name="i-lucide-arrow-right" class="mt-6 size-5 shrink-0 text-muted" />
            <span
              class="mt-4 flex items-center gap-1.5 rounded-md bg-elevated px-2 py-1.5 ring-1 ring-accented"
            >
              <UIcon name="i-lucide-folder" class="size-4 text-muted" />
              <span class="font-medium text-highlighted">Contents</span>
            </span>
          </div>
        </div>
      </li>

      <li class="grid gap-3 sm:grid-cols-2 sm:gap-5">
        <div>
          <h3 class="font-semibold text-highlighted">
            <span class="me-1.5 text-muted">3</span>Scan again
          </h3>
          <p class="mt-1 text-sm text-muted">
            The folder is in the list, marked
            <span class="text-default">Live’s own content</span>. Scan again: samples of the Core
            Library are found now, and content that Live moved between versions is recognised.
          </p>
        </div>
        <!-- The row the folder gets in the list. -->
        <div
          class="self-start rounded-lg border border-default px-3 py-2.5 text-xs"
          aria-hidden="true"
          data-testid="guide-picture"
        >
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-folder" class="size-4 text-muted" />
            <span class="text-sm font-medium text-highlighted">Contents</span>
            <span class="text-muted">Live’s own content</span>
            <UIcon name="i-lucide-circle-check" class="ms-auto size-4 text-(--status-fine)" />
          </div>
        </div>
      </li>
    </ol>

    <div class="mt-6 grid gap-3 rounded-lg bg-elevated/60 p-4 sm:grid-cols-2 sm:gap-5">
      <div class="text-sm" data-testid="guide-dialog-note">
        <p class="font-medium text-highlighted">
          Should your browser say it cannot open the folder
        </p>
        <p class="mt-1 text-muted">
          Press <span class="text-default">Cancel</span>. The page has the folder all the same: a
          browser reads an app’s folder for a page, it only keeps none for your next visit. So the
          Live app is added again on every visit.
        </p>
      </div>
      <!-- The browser's own dialog, as Chrome, Edge and Brave show it. -->
      <div
        class="rounded-lg border border-default bg-default p-3 text-xs shadow-sm"
        aria-hidden="true"
        data-testid="guide-picture"
      >
        <p class="text-sm font-medium text-highlighted">Can’t open this folder</p>
        <p class="mt-1 text-muted">
          This site can’t open this folder because it contains system files
        </p>
        <div class="mt-2 flex justify-end gap-2">
          <span class="rounded-full px-2.5 py-1 font-medium ring-2 ring-inverted">Cancel</span>
          <span class="rounded-full bg-accented px-2.5 py-1 text-muted">
            Choose a different folder
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
