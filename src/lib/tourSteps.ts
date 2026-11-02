// The guided tour's steps, as plain data. The Tour component supplies the behaviour (the
// demos); keeping the text, order and rules here makes them easy to test.
import type { TabId } from "./tabs";

/** Which "Show me" demonstration a step runs. */
export type DemoId = "theme" | "size" | "options" | "refresh" | "devices";

export interface TourStep {
  id: string;
  /** The id of the element to highlight. A step without one is shown centred. */
  target?: string;
  title: string;
  body: string;
  /** The tab this step's target lives on. The tour switches to it, and puts the visitor's tab back at the end. */
  tab?: TabId;
  /** Only shown to signed-in visitors. */
  signedInOnly?: boolean;
  demo?: DemoId;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    title: "Welcome",
    body:
      "This page shows the current version of each Apple operating system. This short tour covers the controls. " +
      "You can move at your own pace, and press Escape at any time to leave.",
  },
  {
    id: "tabs",
    target: "tabs",
    title: "Two views",
    body:
      "Use these tabs to switch between every Apple OS and your own saved devices. Sign in to save your devices " +
      "and see the newest version each one can run.",
  },
  {
    id: "settings",
    target: "settings-btn",
    title: "The settings menu",
    body:
      "The gear button at the top right opens the settings menu: theme, text size, and which versions to show. " +
      "The next few steps open it for you.",
  },
  {
    id: "theme",
    target: "tour-theme",
    title: "Choose a theme",
    body: "Light, Dark and Terminal themes are all designed to be easy to read. Your choice is remembered.",
    demo: "theme",
  },
  {
    id: "size",
    target: "tour-size",
    title: "Change the text size",
    body: "Use A+ and A− to resize the text. Your browser's own zoom (Ctrl or Cmd with + and −) also works.",
    demo: "size",
  },
  {
    id: "options",
    target: "tour-options",
    title: "Show or hide versions",
    body:
      "Older versions (outside the three newest major releases) are hidden by default. " +
      "Turn on Beta versions to see the newest beta in testing, if Apple has one.",
    demo: "options",
  },
  {
    id: "refresh",
    target: "refresh",
    title: "Refresh the data",
    body:
      "The circular arrow button next to the gear reloads the version information. " +
      "Hover over or focus any control to see a tooltip explaining it.",
    demo: "refresh",
  },
  {
    id: "supported-devices",
    target: "tour-supported-devices",
    tab: "versions",
    title: "See which devices can run each OS",
    body:
      "Under each card, Supported devices lists every device that can run that version, grouped by category, with " +
      "the first and last release each one supports. The release lines in the Other versions tables work the same way.",
    demo: "devices",
  },
  {
    id: "save-devices",
    target: "tour-add-device",
    tab: "devices",
    signedInOnly: true,
    title: "Save your devices",
    body:
      "Choose a category, then your device, and add a nickname if you like. Each saved device shows the oldest and " +
      "newest OS it can run, and whether that version still receives updates. Your list is private to your account " +
      "and is remembered between visits.",
  },
  { id: "done", title: "You're all set", body: "Choose Take the tour at any time to see this again." },
];

/** The steps a visitor sees: signed-in-only steps are left out for signed-out visitors. */
export function tourSteps(signedIn: boolean): TourStep[] {
  return TOUR_STEPS.filter((s) => signedIn || !s.signedInOnly);
}
