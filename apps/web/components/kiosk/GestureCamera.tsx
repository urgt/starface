"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

import { useGestureDetector } from "./useGestureDetector";

export type GestureCameraHandle = {
  capture: () => string | null;
};

type Props = {
  active: boolean;
  onGestureDetected: () => void;
  mirrored?: boolean;
};

export const GestureCamera = forwardRef<GestureCameraHandle, Props>(function GestureCamera(
  { active, onGestureDetected, mirrored = true },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [camError, setCamError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);

  useEffect(() => {
    let stream: MediaStream | null = null;
    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
          audio: false,
        });
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setStreaming(true);
        }
      } catch (err) {
        console.warn("camera error", err);
        setCamError((err as Error).message || "camera_failed");
      }
    }
    start();
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      setStreaming(false);
    };
  }, []);

  const { state, progress } = useGestureDetector({
    videoRef,
    enabled: active && streaming,
    onVictoryHold: onGestureDetected,
    holdMs: 500,
  });

  const capture = useCallback(() => {
    const video = videoRef.current;
    if (!video) return null;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Capture un-mirrored so faces are oriented correctly for the ML service
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  }, []);

  useImperativeHandle(ref, () => ({ capture }), [capture]);

  return (
    <div className="relative h-full w-full overflow-hidden">
      <video
        ref={videoRef}
        className={`h-full w-full object-cover ${mirrored ? "scale-x-[-1]" : ""}`}
        playsInline
        muted
      />

      {camError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80">
          <p className="max-w-md px-6 text-center text-red-300">
            Камера недоступна: {camError}
          </p>
        </div>
      )}

      {active && state === "loading" && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm">
          Загрузка жестов...
        </div>
      )}

      {active && state === "ready" && progress > 0 && (
        <div className="absolute bottom-10 left-1/2 -translate-x-1/2">
          <div className="h-2 w-64 overflow-hidden rounded-full bg-white/20">
            <div
              className="h-full bg-[var(--brand-primary)] transition-[width] duration-75"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
});
