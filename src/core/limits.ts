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

/** A path that climbs to the body in a deep tree runs long, and a cut one
 *  points at some other element. */
export const MAX_SELECTOR = 2000;

/** Longest route an update note records as its context. */
export const MAX_UPDATE_NOTE_ROUTE = 2000;

/** Largest JSON request body the HTTP adapters read, in bytes. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** Largest npm registry answer the update check reads, in bytes. */
export const MAX_REGISTRY_BYTES = 64 * 1024;

/** Largest daily update-check cache file read back, in bytes. */
export const MAX_UPDATE_CACHE_BYTES = 4096;

/** Largest "already noted" update state file read back, in bytes. */
export const MAX_UPDATE_NOTED_BYTES = 64 * 1024;
