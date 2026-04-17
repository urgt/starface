"use client";

import { useEffect, useRef, useState } from "react";

type GestureState = "idle" | "loading" | "ready" | "error";

type UseGestureDetectorOpts = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  onVictoryHold: () => void;
  holdMs?: number;
};

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const WASM_ROOT = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.34/wasm";

// MediaPipe/TF Lite WASM writes benign "INFO:" / "W0000 ...:" / "I0000 ...:" lines
// to stderr. In browsers that maps to console.error, which the Next.js dev overlay
// then reports as an unhandled error. Silence just these prefixes once per page.
let consolePatched = false;
function suppressMediaPipeInfoLogs() {
  if (consolePatched || typeof window === "undefined") return;
  consolePatched = true;
  const orig = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (/^(INFO:|W0000 |I0000 )/.test(first)) {
      console.debug(...args);
      return;
    }
    orig(...args);
  };
}

export function useGestureDetector({
  videoRef,
  enabled,
  onVictoryHold,
  holdMs = 500,
}: UseGestureDetectorOpts) {
  const [state, setState] = useState<GestureState>("idle");
  const [progress, setProgress] = useState(0);
  const recognizerRef = useRef<import("@mediapipe/tasks-vision").GestureRecognizer | null>(null);
  const victorySinceRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const firedRef = useRef(false);
  const lastTsRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        suppressMediaPipeInfoLogs();
        setState("loading");
        const vision = await import("@mediapipe/tasks-vision");
        const filesetResolver = await vision.FilesetResolver.forVisionTasks(WASM_ROOT);
        const recognizer = await vision.GestureRecognizer.createFromOptions(filesetResolver, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 1,
        });
        if (cancelled) {
          recognizer.close();
          return;
        }
        recognizerRef.current = recognizer;
        setState("ready");
      } catch (err) {
        console.warn("gesture init failed", err);
        setState("error");
      }
    }

    init();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      recognizerRef.current?.close();
      recognizerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!enabled || state !== "ready") return;

    firedRef.current = false;
    victorySinceRef.current = null;
    setProgress(0);

    const tick = () => {
      const video = videoRef.current;
      const recognizer = recognizerRef.current;
      if (!video || !recognizer || video.readyState < 2) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const ts = performance.now();
      if (ts - lastTsRef.current > 50) {
        lastTsRef.current = ts;
        try {
          const result = recognizer.recognizeForVideo(video, ts);
          const top = result.gestures[0]?.[0];
          const isVictory = top?.categoryName === "Victory" && top.score > 0.6;

          if (isVictory) {
            if (victorySinceRef.current == null) victorySinceRef.current = ts;
            const held = ts - victorySinceRef.current;
            setProgress(Math.min(1, held / holdMs));
            if (held >= holdMs && !firedRef.current) {
              firedRef.current = true;
              onVictoryHold();
            }
          } else {
            victorySinceRef.current = null;
            setProgress(0);
          }
        } catch (err) {
          console.warn("gesture frame failed", err);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [enabled, state, videoRef, onVictoryHold, holdMs]);

  return { state, progress };
}
