// Auth strategy contract (documentation) + shared error helpers.
//
// A strategy is a module exposing:
//   async verify(idToken, name?) -> { email, name, sub, provider }
// It throws a ConnectError with Code.Unauthenticated when the token is missing
// or invalid, and Code.FailedPrecondition when the server is misconfigured
// (e.g. a required *_CLIENT_ID env var is unset).
//
// `name` is an optional display name the client may forward. Apple only sends
// the user's name on the first authorization, out-of-band from the JWT, so a
// strategy that cannot derive a name from the token itself accepts it here;
// strategies that can (Google) ignore the argument.
import { ConnectError, Code } from "@connectrpc/connect";

export { ConnectError, Code };

/** @typedef {{ email: string, name: string, sub: string, provider: string }} AuthUser */

export function authError(message, code = Code.Unauthenticated) {
  return new ConnectError(message, code);
}
