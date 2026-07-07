// Provider registry: pick an auth strategy by provider name. Empty/unset
// defaults to "google" for backward compatibility with clients that only set
// google_id_token; anything unrecognized is an InvalidArgument.
import { ConnectError, Code } from "@connectrpc/connect";
import * as google from "./google.js";
import * as apple from "./apple.js";

const STRATEGIES = { google, apple };

/**
 * @param {string} provider "google" | "apple" (empty/unset -> "google").
 * @returns the matching strategy module (exposes async verify()).
 * @throws {ConnectError} Code.InvalidArgument for an unrecognized provider.
 */
export function getStrategy(provider) {
  const key = String(provider || "google").toLowerCase();
  const strategy = STRATEGIES[key];
  if (!strategy) throw new ConnectError(`Unknown auth provider: ${provider}`, Code.InvalidArgument);
  return strategy;
}
