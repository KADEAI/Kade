
import { atom } from "jotai"

/**
 * Atom to store the sidebar collapsed/expanded state.
 * Default is true (open).
 */
export const isSidebarOpenAtom = atom<boolean>(true)

/**
 * Atom to store the sidebar width in pixels.
 * Default is 250px.
 */
export const sidebarWidthAtom = atom<number>(250)
