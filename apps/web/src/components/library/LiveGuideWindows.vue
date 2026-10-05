<script setup lang="ts">
/**
 * The steps on Windows: Live keeps its content in a folder of its own that Windows hides,
 * `C:\ProgramData\Ableton`. Written from what Ableton documents: livesaver is made and tested
 * on a Mac. The pictures are drawn here, like the Mac's.
 */
const OTHER_FOLDERS = ['Program']
</script>

<template>
  <div>
    <ol class="space-y-6" data-testid="live-guide">
      <li class="grid gap-3 sm:grid-cols-2 sm:gap-5">
        <div>
          <h3 class="font-semibold text-highlighted">
            <span class="me-1.5 text-muted">1</span>Open Live’s folder
          </h3>
          <p class="mt-1 text-sm text-muted">
            Windows hides it. In File Explorer, click into the address bar, type
            <code class="text-xs">C:\ProgramData\<wbr>Ableton</code>
            and press <UKbd value="enter" />. Open the folder of your Live, for example
            <span class="text-default">Live 12 Suite</span>.
          </p>
        </div>
        <!-- A File Explorer window, with the folder that is meant. -->
        <div
          class="rounded-lg border border-default bg-elevated/40 text-xs"
          aria-hidden="true"
          data-testid="guide-picture"
        >
          <div class="border-b border-default px-3 py-2">
            <span
              class="block rounded bg-default px-2 py-1 font-medium text-highlighted ring-1 ring-accented"
            >
              C:\ProgramData\Ableton\Live 12 Suite
            </span>
          </div>
          <ul class="space-y-0.5 p-1.5">
            <li
              v-for="folder in OTHER_FOLDERS"
              :key="folder"
              class="flex items-center gap-2 px-2 py-1.5 text-dimmed"
            >
              <UIcon name="i-lucide-folder" class="size-4" />
              {{ folder }}
            </li>
            <li
              class="flex items-center gap-2 rounded-md bg-elevated px-2 py-1.5 ring-1 ring-accented"
            >
              <UIcon name="i-lucide-folder" class="size-4 text-muted" />
              <span class="font-medium text-highlighted">Resources</span>
            </li>
          </ul>
        </div>
      </li>

      <li class="grid gap-3 sm:grid-cols-2 sm:gap-5">
        <div>
          <h3 class="font-semibold text-highlighted">
            <span class="me-1.5 text-muted">2</span>Drag “Resources” onto “Sample folders”
          </h3>
          <p class="mt-1 text-sm text-muted">
            Take the folder <span class="text-default">Resources</span> with the mouse and drop it
            on the list of sample folders on this page. Only its Core Library is read.
          </p>
          <p class="mt-2 text-sm text-muted">
            Or use “Add folder”: in its dialog, type the path into the address bar and choose the
            folder:
            <code class="text-xs"
              >C:\ProgramData\<wbr>Ableton\<wbr>Live 12 Suite\<wbr>Resources</code
            >
          </p>
        </div>
        <!-- The folder on its way into the list. -->
        <div class="space-y-2 text-xs" aria-hidden="true" data-testid="guide-picture">
          <div class="flex items-center gap-2">
            <span
              class="flex -rotate-3 items-center gap-2 rounded-md bg-elevated px-2 py-1.5 shadow-md ring-1 ring-accented"
            >
              <UIcon name="i-lucide-folder" class="size-4 text-muted" />
              <span class="font-medium text-highlighted">Resources</span>
            </span>
            <UIcon name="i-lucide-arrow-right" class="size-5 shrink-0 text-muted" />
            <span
              class="flex-1 rounded-lg border-2 border-dashed border-accented px-3 py-3 text-center"
            >
              <span class="block font-medium text-highlighted">Sample folders</span>
              <span class="text-muted">drop it here</span>
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
            <span class="text-sm font-medium text-highlighted">Resources</span>
            <span class="text-muted">Live’s own content</span>
            <UIcon name="i-lucide-circle-check" class="ms-auto size-4 text-(--status-fine)" />
          </div>
        </div>
      </li>
    </ol>

    <div class="mt-6 rounded-lg bg-elevated/60 p-4 text-sm" data-testid="guide-dialog-note">
      <p class="font-medium text-highlighted">Should your browser say it cannot open the folder</p>
      <p class="mt-1 text-muted">
        Press <span class="text-default">Cancel</span>. The page has the folder all the same: a
        browser reads such a folder for a page, it only keeps none for your next visit. So Live’s
        folder is added again on every visit.
      </p>
      <p class="mt-2 text-muted" data-testid="guide-untested">
        These steps follow what Ableton says of Windows. livesaver is made and tested on a Mac:
        should a step not fit your computer, please tell us.
      </p>
    </div>
  </div>
</template>
