/**
 * Whether "Where this app runs" is open. The sidebar opens it, and so does whatever says that
 * the page cannot do something as it runs now: that dialog is where the ways to change it are.
 */
import { ref } from 'vue'

export const whereOpen = ref(false)
