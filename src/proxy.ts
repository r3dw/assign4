import { clerkMiddleware } from "@clerk/nextjs/server";

// Makes the signed-in user available to pages and API routes. Nothing is blocked
// here: the version page stays public, as in version 1. Routes that need a
// signed-in user check for one themselves.
export default clerkMiddleware();

export const config = {
  matcher: [
    // Skip Next.js internals and static files, unless they appear in the query string.
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    // Always run for API routes.
    "/(api|trpc)(.*)",
  ],
};
