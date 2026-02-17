// src/types/express.d.ts
import "express";

declare global {
  namespace Express {
    interface Request {
      params: Record<string, string>;
      query: Record<string, string | undefined>;
    }
  }
}

export {};