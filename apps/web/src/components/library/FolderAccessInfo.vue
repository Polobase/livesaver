<script setup lang="ts">
/**
 * How a page comes by the folders it reads, said where the folders are added. A browser calls
 * handing a folder to a page an "upload", and asks about it in words that sound like more than
 * they mean: this box says first that nothing leaves the computer, then how it works for those
 * who want to know, and what the browser's questions mean.
 */
import { ref } from 'vue'
import { keepsDroppedFolders } from '../../engine/storage'
import { useWritingStore } from '../../stores/writing'

/**
 * `compact`: where the folders are looked at again, after a scan. The box then says its one
 * sentence, and keeps the rest behind "How it works".
 */
const props = defineProps<{ compact?: boolean }>()
const writing = useWritingStore()
/** Chrome, Edge, Brave: a drop comes with a handle, which a page can keep. */
const keepsDrops = keepsDroppedFolders()
const open = ref(false)
</script>

<template>
  <UAlert
    color="neutral"
    variant="subtle"
    icon="i-lucide-shield-check"
    :ui="{ icon: 'text-(--status-fine)' }"
    role="note"
    data-testid="kept-note"
  >
    <template #title>Nothing is uploaded: your files stay on your computer</template>
    <template #description>
      <template v-if="!props.compact || open">
        <p>
          This page reads your folders inside your browser. Your browser calls handing a folder to a
          page an “upload”, and may ask “Upload 1,234 files to this site?”: it means “let this page
          read them”. livesaver has no server, and nothing is sent anywhere.
        </p>
        <p class="mt-1.5">
          This browser keeps the list of your folders for your next visit, with what you typed and
          ticked.
          <template v-if="keepsDrops">
            A folder you dropped is read again then, once you allow it; one you chose with “Add
            folder” has to be added again. So drop the folders you want kept.
          </template>
          <template v-else>The folders themselves have to be added again then.</template>
        </p>
      </template>
      <UButton
        class="p-0 text-default underline"
        :class="props.compact && !open ? '' : 'mt-2'"
        color="neutral"
        variant="link"
        size="sm"
        :icon="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
        :label="open ? 'How it works' : 'How it works, and what your browser may ask'"
        :aria-expanded="open"
        aria-controls="folder-access"
        data-testid="how-it-works"
        @click="open = !open"
      />
      <div v-if="open" id="folder-access" class="mt-2 space-y-3" data-testid="folder-access">
        <div>
          <p class="font-medium text-highlighted">How a page reads a folder</p>
          <p>
            A page cannot look at your disk. It gets a folder only when you hand it one, through
            what browsers offer a page for that:
          </p>
          <ul class="mt-1 list-disc space-y-1 ps-5">
            <li>
              <span class="font-medium text-highlighted">A drop, or “Add folder”</span>
              (the folder upload and the File and Directory Entries API): the page is shown every
              file of the folder, and reads the ones it needs, on your computer, for this visit.
            </li>
            <li v-if="keepsDrops">
              <span class="font-medium text-highlighted">A handle</span>
              (the File System Access API of Chrome, Edge and Brave): with a drop your browser also
              gives the page a handle to the folder. The page keeps it, so after a reload it can ask
              your browser for the folder again, and you press “Allow”.
            </li>
            <li v-if="writing.on">
              <span class="font-medium text-highlighted">Editing</span>: with fixing switched on,
              the page asks your browser for the right to save into your project folder. Your
              browser names the folder, and you can take the right back in its settings for this
              site. Drop the project folder rather than choosing it in the dialog: through a handle
              alone your browser hides files with some names (a “/” as Finder shows it, or a space
              at the start or end), and a drop shows the page every file.
            </li>
          </ul>
        </div>
        <div>
          <p class="font-medium text-highlighted">What your browser may ask or say</p>
          <dl class="mt-1 space-y-1">
            <div>
              <dt class="inline font-medium text-highlighted">“Upload … files to this site?”</dt>
              <dd class="inline">
                Let this page read them. That is all: nothing leaves your computer.
              </dd>
            </div>
            <div v-if="keepsDrops">
              <dt class="inline font-medium text-highlighted">“Let site view files?”</dt>
              <dd class="inline">
                Let the page read a folder again that you handed it before. “Allow on every visit”
                spares you the question next time.
              </dd>
            </div>
            <div v-if="writing.on">
              <dt class="inline font-medium text-highlighted">
                “Let site edit files?” or “Save changes?”
              </dt>
              <dd class="inline">
                Let the page write a fix into your project folder: the sets it rewrites, their
                backups, and the samples it copies in.
              </dd>
            </div>
            <div v-if="keepsDrops">
              <dt class="inline font-medium text-highlighted">
                “Can’t open this folder because it contains system files”
              </dt>
              <dd class="inline">
                Said of a folder of the system or of an app. Press Cancel: the page reads the folder
                all the same, it only cannot keep it for your next visit.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </template>
  </UAlert>
</template>
