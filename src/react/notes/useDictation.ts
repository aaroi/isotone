import { useCallback, useEffect, useRef, useState } from 'react';
import type { DraftText } from './useDraft';

/** The parts of the Web Speech API the composer uses; browsers type it differently or not at all. */
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

function recognitionOf(view: Window | undefined): (new () => Recognition) | null {
  const host = view as unknown as
    | { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }
    | undefined;
  return host?.SpeechRecognition ?? host?.webkitSpeechRecognition ?? null;
}

/** Speech joined to what is already written: one space between, none doubled. */
function joined(base: string, speech: string): string {
  const said = speech.trim();
  if (!said) return base;
  return base && !/\s$/.test(base) ? `${base} ${said}` : `${base}${said}`;
}

const BLOCKED = new Set(['not-allowed', 'service-not-allowed']);

export interface Dictation {
  /** The browser has speech recognition; without it the composer shows no microphone. */
  supported: boolean;
  listening: boolean;
  /** Why it stopped, when the reviewer has to do something about it. */
  problem: string;
  toggle(): void;
  stop(): void;
}

/**
 * Speaking a note. Words land in the draft as they are recognised: settled
 * phrases are kept, the phrase still being heard is replaced as it firms up.
 * Typing while listening is respected: the field as typed is kept, the phrase
 * that was being heard ends there, and the next phrase follows it.
 */
export function useDictation(draft: DraftText, enabled: boolean): Dictation {
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState('');
  const session = useRef<Recognition | null>(null);
  const supported = enabled && recognitionOf(typeof window === 'undefined' ? undefined : window) !== null;

  const stop = useCallback(() => {
    const running = session.current;
    session.current = null;
    if (!running) return;
    running.onresult = running.onerror = running.onend = null;
    // `stop` would still deliver the phrase in flight, after the note was sent.
    running.abort();
    setListening(false);
  }, []);
  /** Stop, and drop what was said about why it stopped: sent, closed or turned off. */
  const reset = useCallback(() => {
    stop();
    setProblem('');
  }, [stop]);

  const toggle = useCallback(() => {
    if (session.current) {
      stop();
      return;
    }
    const Recognizer = recognitionOf(window);
    if (!Recognizer) return;
    const recognition = new Recognizer();
    recognition.lang = document.documentElement.lang || navigator.language || 'en-US';
    recognition.continuous = true;
    recognition.interimResults = true;
    // What the field held before the phrase now being heard, and what we last wrote there.
    let base = draft.get();
    let written = base;
    // Results before this index are already part of `base`.
    let settled = 0;
    recognition.onresult = (event) => {
      if (session.current !== recognition) return;
      // The reviewer typed meanwhile: what the field holds is theirs now, the
      // phrase being heard included, so the rest of that phrase is let go
      // rather than written a second time.
      if (draft.get() !== written) {
        base = written = draft.get();
        settled = event.results.length;
        return;
      }
      let hearing = '';
      for (let i = Math.max(settled, 0); i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result?.[0]?.transcript ?? '';
        if (result?.isFinal) {
          base = joined(base, transcript);
          settled = i + 1;
        } else hearing += transcript;
      }
      written = joined(base, hearing);
      draft.set(written);
    };
    recognition.onerror = (event) => {
      if (BLOCKED.has(event.error)) setProblem('Microphone access is blocked for this page.');
      else if (event.error === 'audio-capture') setProblem('No microphone was found.');
      else if (event.error === 'network') setProblem('Dictation needs a connection in this browser.');
    };
    recognition.onend = () => {
      if (session.current !== recognition) return;
      session.current = null;
      setListening(false);
    };
    try {
      recognition.start();
    } catch {
      return;
    }
    session.current = recognition;
    setProblem('');
    setListening(true);
  }, [draft, stop]);

  // Turned off, or the composer gone: the microphone goes with it.
  useEffect(() => {
    if (!enabled) reset();
    return stop;
  }, [enabled, stop, reset]);

  return { supported, listening, problem, toggle, stop: reset };
}
