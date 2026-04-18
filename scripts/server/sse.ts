import type { ServerResponse, IncomingMessage } from "node:http";

export type SseConnection = {
  send: (event: string, data: unknown) => void;
  close: () => void;
};

export function openSse(req: IncomingMessage, res: ServerResponse): SseConnection {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const heartbeat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      /* client gone */
    }
  }, 15000);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    try {
      res.end();
    } catch {
      /* noop */
    }
  };

  req.on("close", close);

  return {
    send(event, data) {
      if (closed) return;
      try {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch {
        close();
      }
    },
    close,
  };
}
