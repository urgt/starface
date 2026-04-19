"use client";

import { useEffect, useRef, useState } from "react";

import { MEDIAPIPE_WASM_ROOT } from "@/lib/face-embed";

type GestureState = "idle" | "loading" | "ready" | "error";

type UseGestureDetectorOpts = {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  enabled: boolean;
  onVictoryHold: () => void;
  holdMs?: number;
};

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task";
const TICK_MS = 50;

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

type RIC = (cb: () => void, opts?: { timeout: number }) => number;
const scheduleIdle = (cb: () => void): number => {
  if (typeof window === "undefined") return 0;
  const ric = (window as unknown as { requestIdleCallback?: RIC }).requestIdleCallback;
  if (ric) return ric(cb, { timeout: 1500 });
  return window.setTimeout(cb, 300);
};
const cancelIdle = (id: number) => {
  if (typeof window === "undefined") return;
  const cric = (window as unknown as { cancelIdleCallback?: (id: number) => void }).cancelIdleCallback;
  if (cric) cric(id);
  else window.clearTimeout(id);
};

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
  const firedRef = useRef(false);

  // Lazy init: don't download the MediaPipe WASM + gesture model until the
  // camera stream is actually up. On slow TVs this removes a ~2MB blocking
  // download from the initial /kiosk page-load waterfall.
  // Dep is `[enabled]` only — this effect itself calls setState, so adding
  // `state` to deps would cause it to cancel and close its own recognizer
  // mid-init.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let idleId = 0;

    async function init() {
      if (cancelled || recognizerRef.current) return;
      try {
        suppressMediaPipeInfoLogs();
        setState("loading");
        const vision = await import("@mediapipe/tasks-vision");
        const filesetResolver = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_ROOT);
        const createWith = async (delegate: "GPU" | "CPU") =>
          vision.GestureRecognizer.createFromOptions(filesetResolver, {
            baseOptions: { modelAssetPath: MODEL_URL, delegate },
            runningMode: "VIDEO",
            numHands: 1,
          });
        let recognizer: import("@mediapipe/tasks-vision").GestureRecognizer;
        try {
          recognizer = await createWith("GPU");
        } catch (gpuErr) {
          // Many embedded-TV browsers lack WebGL2 — fall back to CPU so we
          // at least get the gesture gate rather than erroring the kiosk.
          console.warn("gesture GPU delegate failed, retrying with CPU", gpuErr);
          recognizer = await createWith("CPU");
        }
        if (cancelled) {
          recognizer.close();
          return;
        }
        recognizerRef.current = recognizer;
        setState("ready");
      } catch (err) {
        console.warn("gesture init failed", err);
        if (!cancelled) setState("error");
      }
    }

    idleId = scheduleIdle(init);

    return () => {
      cancelled = true;
      if (idleId) cancelIdle(idleId);
      recognizerRef.current?.close();
      recognizerRef.current = null;
    };
  }, [enabled]);

  // Gesture polling: setInterval at TICK_MS so we don't burn 60fps of empty
  // RAF callbacks on idle TV CPUs. Paused when the page is hidden.
  useEffect(() => {
    if (!enabled || state !== "ready") return;

    firedRef.current = false;
    victorySinceRef.current = null;
    setProgress(0);

    const tick = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      const video = videoRef.current;
      const recognizer = recognizerRef.current;
      if (!video || !recognizer || video.readyState < 2) return;

      const ts = performance.now();
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
    };

    const intervalId = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(intervalId);
  }, [enabled, state, videoRef, onVictoryHold, holdMs]);

  return { state, progress };
}
