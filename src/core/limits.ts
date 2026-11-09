/**
 * Every size cap in one place. Browser-safe: the panel and the Node stores
 * read the same numbers.
 */

/** Maximum feedback length after trimming, shared by browser and server. */
export const MAX_FEEDBACK_LENGTH = 4000;

/** Serialized-size ceiling for a note's opaque `payload`, in bytes. Generous
 *  next to normal review context and small
 *  enough that a runaway host is rejected rather than bloating the file. */
export const PAYLOAD_MAX = 65_536;

/** Longest agent reply `isotone --reply` stores. */
export const MAX_REPLY_LENGTH = 2000;

/** Most answers `isotone --reply --choice` offers: a few known ones, never a menu. */
export const MAX_REPLY_CHOICES = 4;

/** Longest offered answer: one button's label in the panel. */
export const MAX_CHOICE_LENGTH = 60;

/** Longest summary `isotone --done -m` stores: one line for the reviewer. */
export const MAX_RESOLUTION_LENGTH = 500;

/** A path that climbs to the body in a deep tree runs long, and a cut one
 *  points at some other element. */
export const MAX_SELECTOR = 2000;

/** Longest route a note records. */
export const MAX_ROUTE = 2000;

/** Most notes one notes file holds; a new note past this is refused. */
export const MAX_NOTES = 10_000;

/** Largest JSON request body the HTTP adapters read, in bytes. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** Largest npm registry answer the update check reads, in bytes. */
export const MAX_REGISTRY_BYTES = 64 * 1024;

/** Largest daily update-check cache file read back, in bytes. */
export const MAX_UPDATE_CACHE_BYTES = 4096;

/** Largest "already noted" update state file read back, in bytes. */
export const MAX_UPDATE_NOTED_BYTES = 64 * 1024;
