"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, forwardRef } from "react";

import { useGestureDetector } from "./useGestureDetector";

export type GestureCameraHandle = {
  capture: () => string | null;
  captureBurst: (count?: number, intervalMs?: number) => Promise<string[]>;
};

export type GestureCameraVariant = "fullscreen" | "corner" | "hidden";

type Props = {
  active: boolean;
  onGestureDetected: () => void;
  mirrored?: boolean;
  variant?: GestureCameraVariant;
};

type CamErrorCode =
  | "insecure_context"
  | "camera_unsupported"
  | "permission_denied"
  | "no_camera"
  | "camera_failed"
  | string;

export const GestureCamera = forwardRef<GestureCameraHandle, Props>(function GestureCamera(
  { active, onGestureDetected, mirrored = true, variant = "fullscreen" },
  ref,
) {
  // The rendered <video> changes identity when `variant` switches
  // (hidden <-> corner <-> fullscreen), so we use a callback ref that
  // re-attaches the MediaStream to whichever <video> element is currently
  // mounted. Without this, the second idle-screen visit rendered a fresh
  // <video> that never got the stream hooked up — black preview + no gesture.
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [camError, setCamError] = useState<CamErrorCode | null>(null);
  const [streaming, setStreaming] = useState(false);

  const setVideoEl = useCallback((el: HTMLVideoElement | null) => {
    videoRef.current = el;
    const stream = streamRef.current;
    if (el && stream && el.srcObject !== stream) {
      el.srcObject = stream;
      // Autoplay is allowed because the kiosk already had a user gesture to
      // enter the flow; .catch suppresses the rare "play interrupted" warning.
      el.play().catch(() => {});
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function start() {
      const isLoopback =
        typeof window !== "undefined" &&
        /^(localhost|127\.|\[?::1\]?)/i.test(window.location.hostname);
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCamError(
          typeof window !== "undefined" && (window.isSecureContext || isLoopback)
            ? "camera_unsupported"
            : "insecure_context",
        );
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const el = videoRef.current;
        if (el) {
          el.srcObject = stream;
          await el.play();
        }
        setStreaming(true);
      } catch (err) {
        console.warn("camera error", err);
        const name = (err as Error).name;
        if (name === "NotAllowedError" || name === "PermissionDeniedError") {
          setCamError("permission_denied");
        } else if (name === "NotFoundError" || name === "DevicesNotFoundError") {
          setCamError("no_camera");
        } else {
          setCamError((err as Error).message || "camera_failed");
        }
      }
    }
    start();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
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
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  }, []);

  const captureBurst = useCallback(
    async (count = 3, intervalMs = 80): Promise<string[]> => {
      const frames: string[] = [];
      for (let i = 0; i < count; i++) {
        const frame = capture();
        if (frame) frames.push(frame);
        if (i < count - 1) await new Promise((r) => setTimeout(r, intervalMs));
      }
      return frames;
    },
    [capture],
  );

  useImperativeHandle(ref, () => ({ capture, captureBurst }), [capture, captureBurst]);

  // Always hoist a fullscreen error overlay over everything when the camera fails.
  const errorOverlay = camError ? (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 px-6 backdrop-blur-sm">
      <CameraErrorCard code={camError} />
    </div>
  ) : null;

  if (variant === "hidden") {
    return (
      <>
        <video
          ref={setVideoEl}
          className="pointer-events-none absolute -z-10 h-1 w-1 opacity-0"
          playsInline
          muted
        />
        {errorOverlay}
      </>
    );
  }

  if (variant === "corner") {
    return (
      <>
        <div className="pointer-events-none absolute bottom-6 right-6 z-20 w-[260px] overflow-hidden rounded-3xl border border-white/15 bg-black/40 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.8)] backdrop-blur-sm">
          <div className="relative aspect-[3/4]">
            <video
              ref={setVideoEl}
              className={`h-full w-full object-cover ${mirrored ? "scale-x-[-1]" : ""}`}
              playsInline
              muted
            />
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[var(--brand-primary)]/40 to-transparent"
              style={{ animation: "mosaicScroll 4s linear infinite" }}
            />
            <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
              Live
            </div>
            {state === "ready" && progress > 0 && (
              <div className="absolute inset-0 flex items-end justify-center pb-3">
                <div className="h-1.5 w-[180px] overflow-hidden rounded-full bg-white/15">
                  <div
                    className="h-full bg-[var(--brand-primary)] transition-[width] duration-75"
                    style={{ width: `${progress * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
        {errorOverlay}
      </>
    );
  }

  return (
    <div className="relative h-full w-full overflow-hidden">
      <video
        ref={setVideoEl}
        className={`h-full w-full object-cover ${mirrored ? "scale-x-[-1]" : ""}`}
        playsInline
        muted
      />
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
      {errorOverlay}
    </div>
  );
});

function CameraErrorCard({ code }: { code: CamErrorCode }) {
  const host =
    typeof window !== "undefined" ? window.location.host : "localhost:3000";
  const httpsUrl =
    typeof window !== "undefined"
      ? `https://${window.location.host}${window.location.pathname}${window.location.search}`
      : "#";

  const content =
    code === "insecure_context" ? (
      <>
        <Title>Камере нужен HTTPS</Title>
        <Body>
          Браузер не даёт доступ к камере по HTTP на удалённом адресе (
          <Mono>{host}</Mono>). Откройте эту же страницу по HTTPS, и телефон
          спросит разрешение.
        </Body>
        <div className="mt-4 space-y-2 text-left text-sm text-white/80">
          <p className="font-semibold uppercase tracking-[0.2em] text-white/60">
            Что сделать
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Открыть{" "}
              <a
                href={httpsUrl}
                className="underline decoration-[var(--brand-primary)] underline-offset-2"
              >
                {httpsUrl}
              </a>{" "}
              (после установки TLS — см. ниже).
            </li>
            <li>
              Либо на девайсе: Chrome → <Mono>chrome://flags</Mono> →{" "}
              <Mono>Insecure origins treated as secure</Mono> → добавить{" "}
              <Mono>http://{host}</Mono>, перезапустить.
            </li>
            <li>
              Либо временно открыть через HTTPS-туннель:{" "}
              <Mono>cloudflared tunnel --url http://localhost:3000</Mono>.
            </li>
          </ul>
        </div>
      </>
    ) : code === "permission_denied" ? (
      <>
        <Title>Доступ к камере отклонён</Title>
        <Body>
          Разрешите камеру в настройках браузера и перезагрузите страницу.
        </Body>
      </>
    ) : code === "no_camera" ? (
      <>
        <Title>Камера не найдена</Title>
        <Body>Устройство не видит ни одной камеры.</Body>
      </>
    ) : code === "camera_unsupported" ? (
      <>
        <Title>Браузер не поддерживает getUserMedia</Title>
        <Body>Попробуйте обновить браузер или открыть в Chrome / Safari.</Body>
      </>
    ) : (
      <>
        <Title>Камера недоступна</Title>
        <Body className="font-mono text-xs">{code}</Body>
      </>
    );

  return (
    <div className="max-w-xl rounded-3xl border border-white/10 bg-neutral-950/90 p-8 text-center text-white shadow-2xl">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[var(--brand-primary)]/20 text-2xl">
        📷
      </div>
      {content}
    </div>
  );
}

function Title({ children }: { children: React.ReactNode }) {
  return <h3 className="text-2xl font-bold text-white">{children}</h3>;
}

function Body({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`mt-2 text-base text-white/70 ${className}`}>{children}</p>;
}

function Mono({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.85em]">
      {children}
    </code>
  );
}
