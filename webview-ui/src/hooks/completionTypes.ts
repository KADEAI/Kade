/**
 * Dropdown Position information
 */
export interface DropdownPosition {
    top: number
    left: number
    width: number
    height: number
}

/**
 * Trigger Query information
 * Records the trigger character, query text and position range
 */
export interface TriggerQuery {
    /** The query text (excluding the trigger) */
    query: string
    /** Starting position of the trigger in the text */
    start: number
    /** Ending position of the query */
    end: number
    /** The trigger character (e.g., '/' or '@') */
    trigger: string
}

/**
 * Trigger Detection Options
 */
export interface TriggerDetectionOptions {
    /** The trigger character */
    trigger: string
    /** Optional custom regex */
    customRegex?: RegExp
}
