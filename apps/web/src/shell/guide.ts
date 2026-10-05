/**
 * Whether the guide to adding Live's own content is open. Whatever says that this content is
 * missing opens it: the list of what is not added yet, and the notice of a scan made without it.
 */
import { ref } from 'vue'

export const liveGuideOpen = ref(false)
