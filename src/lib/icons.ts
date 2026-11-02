/*
 * Icon artwork from Lucide (https://lucide.dev), used under the ISC License:
 *
 *   Copyright (c) 2026 Lucide Icons and Contributors
 *   Permission to use, copy, modify, and/or distribute this software for any
 *   purpose with or without fee is hereby granted, provided that the above
 *   copyright notice and this permission notice appear in all copies.
 *
 * Each value is the inner markup of a 24x24 stroke icon.
 * Keys match the OS family names returned by /api/versions, plus "refresh" and "settings".
 */
export const ICONS: Record<string, string> = {
  "grid": "<rect width=\"7\" height=\"7\" x=\"3\" y=\"3\" rx=\"1\" /><rect width=\"7\" height=\"7\" x=\"14\" y=\"3\" rx=\"1\" /><rect width=\"7\" height=\"7\" x=\"14\" y=\"14\" rx=\"1\" /><rect width=\"7\" height=\"7\" x=\"3\" y=\"14\" rx=\"1\" />",
  "iOS": "<rect width=\"14\" height=\"20\" x=\"5\" y=\"2\" rx=\"2\" ry=\"2\" /><path d=\"M12 18h.01\" />",
  "iPadOS": "<rect width=\"16\" height=\"20\" x=\"4\" y=\"2\" rx=\"2\" ry=\"2\" /><line x1=\"12\" x2=\"12.01\" y1=\"18\" y2=\"18\" />",
  "macOS": "<path d=\"M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z\" /><path d=\"M20.054 15.987H3.946\" />",
  "watchOS": "<path d=\"M12 10v2.2l1.6 1\" /><path d=\"m16.13 7.66-.81-4.05a2 2 0 0 0-2-1.61h-2.68a2 2 0 0 0-2 1.61l-.78 4.05\" /><path d=\"m7.88 16.36.8 4a2 2 0 0 0 2 1.61h2.72a2 2 0 0 0 2-1.61l.81-4.05\" /><circle cx=\"12\" cy=\"12\" r=\"6\" />",
  "tvOS": "<path d=\"m17 2-5 5-5-5\" /><rect width=\"20\" height=\"15\" x=\"2\" y=\"7\" rx=\"2\" />",
  "visionOS": "<circle cx=\"6\" cy=\"15\" r=\"4\" /><circle cx=\"18\" cy=\"15\" r=\"4\" /><path d=\"M14 15a2 2 0 0 0-2-2 2 2 0 0 0-2 2\" /><path d=\"M2.5 13 5 7c.7-1.3 1.4-2 3-2\" /><path d=\"M21.5 13 19 7c-.7-1.3-1.5-2-3-2\" />",
  "HomePod Software": "<rect width=\"16\" height=\"20\" x=\"4\" y=\"2\" rx=\"2\" /><path d=\"M12 6h.01\" /><circle cx=\"12\" cy=\"14\" r=\"4\" /><path d=\"M12 14h.01\" />",
  "refresh": "<path d=\"M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8\" /><path d=\"M21 3v5h-5\" /><path d=\"M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16\" /><path d=\"M8 16H3v5\" />",
  "settings": "<path d=\"M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915\" /><circle cx=\"12\" cy=\"12\" r=\"3\" />",
};
