import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { ZodError } from "zod";
import { env } from "./env.js";
import { verifyAccessToken, type Session } from "./auth/tokens.js";

export type RequestContext = {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body: unknown;
  session: Session | null;
};

type Handler = (context: RequestContext) => Promise<unknown>;
type Route = { method: string; pattern: RegExp; handler: Handler };

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: RegExp, handler: Handler) {
    this.routes.push({ method, pattern, handler });
  }

  server() {
    return createServer(async (req, res) => {
      setCors(res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      try {
        const url = new URL(req.url ?? "/", env.APP_URL);
        const route = this.routes.find((candidate) => candidate.method === req.method && candidate.pattern.test(url.pathname));
        if (!route) {
          writeJson(res, 404, { error: "not_found" });
          return;
        }

        const body = await readJson(req);
        const session = await sessionFromRequest(req);
        const result = await route.handler({ req, res, url, body, session });
        if (!res.writableEnded) {
          writeJson(res, 200, result ?? {});
        }
      } catch (error) {
        handleError(res, error);
      }
    });
  }
}

export function requireSession(session: Session | null): Session {
  if (!session) {
    const error = new Error("unauthorized");
    error.name = "UnauthorizedError";
    throw error;
  }
  return session;
}

/**
 * Error type for known, safe-to-surface application errors (e.g. "invoice not found").
 * Anything else thrown is treated as unexpected and never exposed to the client.
 */
export class AppError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AppError";
    this.status = status;
  }
}

export function pathId(pattern: RegExp, pathname: string) {
  return pattern.exec(pathname)?.groups?.id ?? "";
}

export function writeJson(res: ServerResponse, status: number, payload: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
}

function setCors(res: ServerResponse) {
  res.setHeader("access-control-allow-origin", env.FRONTEND_ORIGIN);
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type,authorization");
}

async function readJson(req: IncomingMessage) {
  if (req.method === "GET" || req.method === "HEAD") {
    return null;
  }

  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : null;
}

async function sessionFromRequest(req: IncomingMessage) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return null;
  }

  try {
    return await verifyAccessToken(header.slice("Bearer ".length));
  } catch {
    return null;
  }
}

function handleError(res: ServerResponse, error: unknown) {
  if (res.writableEnded) {
    return;
  }

  if (error instanceof ZodError) {
    writeJson(res, 400, { error: "validation_error", details: error.flatten() });
    return;
  }

  if (error instanceof Error && error.name === "UnauthorizedError") {
    writeJson(res, 401, { error: "unauthorized" });
    return;
  }

  if (error instanceof AppError) {
    writeJson(res, error.status, { error: error.message });
    return;
  }

  console.error(error);
  writeJson(res, 500, { error: "internal_server_error" });
}
