// src/types/express.d.ts
//
// Fixes: "Argument of type 'string | string[]' is not assignable to parameter of type 'string'"
// Express defaults req.params to Record<string, string | string[]>.
// In practice, route params are always string. This override fixes it globally.

import "express";

declare module "express" {
  interface ParamsDictionary {
    [key: string]: string;
  }
}

declare module "express-serve-static-core" {
  interface ParamsDictionary {
    [key: string]: string;
  }

}