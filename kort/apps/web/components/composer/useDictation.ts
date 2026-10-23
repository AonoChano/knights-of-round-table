"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type DictationErrorCode = "mic" | "silent" | "network" | "unknown";

type ResultItem = { isFinal: boolean; 0: { transcript: string } };
type ResultEvent = { resultIndex: number; results: ArrayLike<ResultItem> };
type ErrorEvent = { error: string };
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: ResultEvent) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  onend: (() => void) | null;
};
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const holder = window as unknown as Record<string, unknown>;
  const ctor = holder.SpeechRecognition ?? holder.webkitSpeechRecognition;
  return typeof ctor === "function" ? (ctor as RecognitionCtor) : null;
}

const ERROR_CODES: Record<string, DictationErrorCode> = {
  "not-allowed": "mic",
  "service-not-allowed": "mic",
  "no-speech": "silent",
  aborted: "unknown",
  "audio-capture": "mic",
  network: "network",
};

/**
 * Real speech-to-text through the browser's SpeechRecognition service.
 * Final chunks go straight into the composer, interim chunks are shown while
 * the mic is open, and the timer is our own because the API reports none.
 */
export function useDictation({
  lang,
  capSeconds = 90,
  onFinal,
  onError,
}: {
  lang: string;
  capSeconds?: number;
  onFinal: (text: string) => void;
  onError: (code: DictationErrorCode) => void;
}) {
  const [listening, setListening] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [interim, setInterim] = useState("");
  const [supported, setSupported] = useState(false);
  const recognitionRef = useRef<Recognition | null>(null);
  const finalRef = useRef(onFinal);
  const errorRef = useRef(onError);
  finalRef.current = onFinal;
  errorRef.current = onError;

  /* only knowable on the client, so keep the button hidden until we confirm it */
  useEffect(() => setSupported(recognitionCtor() !== null), []);

  const stop = useCallback(() => {
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    setListening(false);
    setInterim("");
    if (recognition) recognition.stop();
  }, []);

  const start = useCallback(() => {
    const ctor = recognitionCtor();
    if (!ctor || recognitionRef.current) return;
    const recognition = new ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      let pending = "";
      let heard = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) heard += text;
        else pending += text;
      }
      setInterim(pending);
      if (heard) finalRef.current(heard.trim());
    };
    recognition.onerror = (event) => {
      recognitionRef.current = null;
      setListening(false);
      setInterim("");
      errorRef.current(ERROR_CODES[event.error] ?? "unknown");
    };
    recognition.onend = () => {
      if (recognitionRef.current !== recognition) return;
      recognitionRef.current = null;
      setListening(false);
      setInterim("");
    };
    recognitionRef.current = recognition;
    setSeconds(0);
    setListening(true);
    try {
      recognition.start();
    } catch {
      recognitionRef.current = null;
      setListening(false);
      errorRef.current("unknown");
    }
  }, [lang]);

  useEffect(() => {
    if (!listening) return;
    const tick = setInterval(() => setSeconds((current) => current + 1), 1000);
    return () => clearInterval(tick);
  }, [listening]);

  useEffect(() => {
    if (!listening || seconds < capSeconds) return;
    stop();
  }, [capSeconds, listening, seconds, stop]);

  useEffect(
    () => () => {
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) recognition.abort();
    },
    []
  );

  return { supported, listening, seconds, interim, start, stop };
}
