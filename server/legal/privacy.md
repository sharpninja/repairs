# Privacy Policy

_Last updated: 2026-07-07._

AI Auto Repairman is a do-it-yourself vehicle-repair companion, built to keep your data on your device. This policy explains what the app stores, what leaves your device, and when.

## What stays on your device

- **Photos, voice notes, and video** you capture are stored only in your browser's **IndexedDB** on this device. They are **never uploaded** to us or anyone else.
- **Progress, guides, inventory, vehicles, VIN, and reviews** are stored in your browser's local storage on this device.
- Because this data is on-device, clearing your browser storage removes it, and it is not synced between devices.

## Your Anthropic API key

The optional "Ask Claude" features use **your own** Anthropic API key. The key is stored **only in your browser** and is used to call **api.anthropic.com** directly from your browser. We never receive or store your key; your prompts and any photos you attach for those features go straight from your browser to Anthropic, under Anthropic's own privacy policy.

## Sign-in

Signing in is optional and is only needed to submit a guide or review to the shared catalog. We support **Google Sign-In** today, and **Apple Sign In** is being added. When you sign in, the identity provider returns a verified email and name to our submit service so we can attribute your submission. We never receive your password.

## Community submissions

When you choose to submit a guide or review, our submit service opens a **public pull request** on GitHub against the guide catalog. Your **name and email** from sign-in are attached to that submission for attribution and moderation. Submissions are automatically screened and reviewed by a human before publication. Do not include personal or sensitive information in a submission, because pull requests are public.

## Diagnostics

If the app hits an unexpected error, it may send a **deidentified** error report (an error message and stack, with API keys, emails, tokens, and VINs stripped out) to our submit service so we can fix bugs. These reports never contain your API key, your content, or your identity.

## Contact

Questions about this policy can be raised as an issue on the project's GitHub repository.

_This document is provided for transparency and is not legal advice._
